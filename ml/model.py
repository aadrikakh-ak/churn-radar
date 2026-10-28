"""Keras ANN definition."""
from __future__ import annotations

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

from . import config as C


def build_ann(input_dim: int, seed: int = C.RANDOM_SEED, prefix: str = "") -> keras.Model:
    """A fully-connected binary classifier.

    Each hidden block is Dense -> BatchNorm -> ReLU -> Dropout. BatchNorm sits
    before the activation so the pre-activations stay centred, which keeps the
    network trainable at the fairly aggressive dropout rates this tabular
    problem needs to avoid memorising 7k rows.
    """
    tf.keras.utils.set_random_seed(seed)

    inputs = keras.Input(shape=(input_dim,), name=f"{prefix}features")
    x = inputs

    for i, (units, rate) in enumerate(zip(C.ARCHITECTURE, C.DROPOUT), start=1):
        x = layers.Dense(
            units,
            use_bias=False,
            kernel_initializer="he_normal",
            kernel_regularizer=keras.regularizers.l2(C.L2_REG),
            name=f"{prefix}dense_{i}",
        )(x)
        x = layers.BatchNormalization(name=f"{prefix}bn_{i}")(x)
        x = layers.Activation("relu", name=f"{prefix}relu_{i}")(x)
        x = layers.Dropout(rate, seed=seed + i, name=f"{prefix}drop_{i}")(x)

    outputs = layers.Dense(1, activation="sigmoid", name=f"{prefix}churn_probability")(x)

    model = keras.Model(inputs, outputs, name=f"{prefix or 'churn_'}ann")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=C.LEARNING_RATE),
        loss=keras.losses.BinaryCrossentropy(),
        metrics=[
            keras.metrics.AUC(name="auc"),
            keras.metrics.AUC(name="pr_auc", curve="PR"),
            keras.metrics.Precision(name="precision"),
            keras.metrics.Recall(name="recall"),
            keras.metrics.BinaryAccuracy(name="accuracy"),
        ],
    )
    return model


def combine_ensemble(members: list[keras.Model], input_dim: int) -> keras.Model:
    """Fuse K trained networks into ONE Keras graph that averages their outputs.

    Seed ensembling is the cheapest reliable win on small tabular data: each
    member lands in a different local minimum, and averaging cancels part of
    the variance. Fusing them into a single model keeps serving and Integrated
    Gradients to one forward/backward pass over one object, so nothing
    downstream has to know an ensemble exists.
    """
    inputs = keras.Input(shape=(input_dim,), name="features")
    outputs = [m(inputs) for m in members]
    averaged = (
        layers.Average(name="ensemble_average")(outputs)
        if len(outputs) > 1
        else outputs[0]
    )
    model = keras.Model(inputs, averaged, name="churn_ann_ensemble")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=C.LEARNING_RATE),
        loss=keras.losses.BinaryCrossentropy(),
        metrics=[keras.metrics.AUC(name="auc"), keras.metrics.AUC(name="pr_auc", curve="PR")],
    )
    return model


def callbacks(checkpoint_path) -> list[keras.callbacks.Callback]:
    return [
        keras.callbacks.EarlyStopping(
            monitor="val_pr_auc",
            mode="max",
            patience=C.PATIENCE,
            restore_best_weights=True,
            verbose=1,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_pr_auc",
            mode="max",
            factor=0.5,
            patience=8,
            min_lr=1e-5,
            verbose=1,
        ),
        keras.callbacks.ModelCheckpoint(
            filepath=str(checkpoint_path),
            monitor="val_pr_auc",
            mode="max",
            save_best_only=True,
            verbose=0,
        ),
    ]
