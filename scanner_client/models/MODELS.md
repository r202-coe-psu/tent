# Face check models

Used by `app/face/` (kiosk face verification). The binaries are not in git: run
`./models/download_models.sh` (done by `setup_big_kiosk.sh`). It checks every file against the
SHA-256 below, so a changed upstream file fails loudly instead of silently changing the check.

| File | Role | Source | License | SHA-256 |
| --- | --- | --- | --- | --- |
| `face_detection_yunet_2023mar.onnx` | find faces + 5 landmarks (YuNet) | [opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | MIT | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_recognition_sface_2021dec.onnx` | 128-d face embedding (SFace) | [opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) | Apache-2.0 | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |
| `MiniFASNetV2.onnx` | liveness, crop 2.7x | [yakhyo/face-anti-spoofing](https://github.com/yakhyo/face-anti-spoofing) (ONNX export of [Minivision](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing)) | Apache-2.0 | `b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907` |
| `MiniFASNetV1SE.onnx` | liveness, crop 4.0x | same | Apache-2.0 | `ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676` |

## How they are used

- **YuNet** runs with OpenCV's `cv2.FaceDetectorYN` (needs OpenCV >= 4.8 for the 2023mar model).
- **SFace** runs with `cv2.FaceRecognizerSF`; two faces are compared by cosine similarity.
- **MiniFASNet**: the two networks see the face with 2.7x and 4.0x of context, resized to 80x80
  (BGR, raw 0-255, NCHW). Their softmax outputs are summed; the face is real when class 1 wins.
  This is the rule of the original `test.py`. Run through `cv2.dnn` (no PyTorch / onnxruntime).

## Changing a model

Never overwrite a file in place: add the new one, update `app/face/engine.py`, add a new threshold
profile in `app/face/profiles.py` (a stored `threshold_profile` must still say which numbers produced
a result) and update this table.

## What is *not* known

The thresholds in `app/face/profiles.py` have not been calibrated on Thai ID-chip photos. See
`docs/plans/kiosk-face-verification-implementation-plan.md` §5.5-5.6.
