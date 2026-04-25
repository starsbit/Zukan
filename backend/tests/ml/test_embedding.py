from __future__ import annotations

import numpy as np
from PIL import Image

from backend.app.ml.embedding import CLIPOnnxEmbeddingBackend


def test_clip_preprocess_uses_nchw_float_tensor():
    backend = CLIPOnnxEmbeddingBackend()
    image = Image.new("RGB", (16, 12), (255, 0, 0))

    tensor = backend._preprocess(image)

    assert tensor.shape == (1, 3, 224, 224)
    assert tensor.dtype == np.float32


def test_clip_selects_512_dimension_output():
    backend = CLIPOnnxEmbeddingBackend()
    vector = np.zeros((1, 512), dtype=np.float32)
    vector[0, 0] = 3.0
    vector[0, 1] = 4.0

    selected = backend._select_embedding_output([np.zeros((1, 50, 768), dtype=np.float32), vector])

    assert selected.shape == (512,)
    assert selected[:2].tolist() == [3.0, 4.0]
