# Moderation model

| | |
|---|---|
| Model | `OwenElliott/image-safety-classifier-xs` |
| Source | https://huggingface.co/OwenElliott/image-safety-classifier-xs |
| File | `image-safety-classifier-xs.onnx` (about 13 MB, preprocessing baked in, 224 px input) |
| Classes (output order) | `nsfw`, `nsfl` (gore), `sfw` — override with env `MODERATION_CLASS_ORDER` if the first eval shows otherwise |
| License | MIT (below) |

The `.onnx` file is **not committed** (`.gitignore`). The `deploy-moderation-service` workflow downloads it
from the source above (`huggingface_hub.snapshot_download`, `*.onnx` only), computes its SHA-256 and compares
it with `model.sha256`.

## Pinning the checksum
`model.sha256` ships as `UNPINNED`. An unpinned model never deploys and never loads:

1. Run the workflow once. The "Check model checksum pin" step prints the file's SHA-256 and fails.
2. Check the model card has not changed (license still MIT, same author), then commit that hash as the only
   line of `model.sha256`.
3. Run the workflow again.

The service verifies the same hash at import (`classifier.verify_sha256`); env `MODERATION_MODEL_SHA256`
overrides the file. A mismatch answers 500 `model unavailable` on every request, so the caller fails closed.

## License (MIT)
Copied from the model card's declared license; the owner confirms it against the card on the first run.

```
MIT License

Copyright (c) OwenElliott

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
