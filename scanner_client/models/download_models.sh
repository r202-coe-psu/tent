#!/bin/bash
# Download the face check models into this directory and verify each against its SHA-256.
# Idempotent: a file that is already present and matches is left alone.
# Usage: ./models/download_models.sh [--check]     (--check: verify only, download nothing)
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ZOO="https://github.com/opencv/opencv_zoo/raw/main/models"
FAS="https://github.com/yakhyo/face-anti-spoofing/releases/download/weights"

# name|url|sha256   (keep in step with MODELS.md)
MODELS=(
    "face_detection_yunet_2023mar.onnx|$ZOO/face_detection_yunet/face_detection_yunet_2023mar.onnx|8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
    "face_recognition_sface_2021dec.onnx|$ZOO/face_recognition_sface/face_recognition_sface_2021dec.onnx|0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
    "MiniFASNetV2.onnx|$FAS/MiniFASNetV2.onnx|b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907"
    "MiniFASNetV1SE.onnx|$FAS/MiniFASNetV1SE.onnx|ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676"
)

CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

sha_of() { sha256sum "$1" | cut -d' ' -f1; }

failed=0
for entry in "${MODELS[@]}"; do
    IFS='|' read -r name url sha <<<"$entry"
    file="$DIR/$name"
    if [ -f "$file" ] && [ "$(sha_of "$file")" = "$sha" ]; then
        echo "ok       $name"
        continue
    fi
    if $CHECK_ONLY; then
        echo "MISSING  $name (or checksum differs)"
        failed=1
        continue
    fi
    echo "download $name"
    tmp="$(mktemp "$DIR/.download.XXXXXX")"
    if curl -fsSL --retry 3 --max-time 300 -o "$tmp" "$url" && [ "$(sha_of "$tmp")" = "$sha" ]; then
        mv "$tmp" "$file"
    else
        rm -f "$tmp"
        echo "FAILED   $name (download error or checksum mismatch)" >&2
        failed=1
    fi
done
exit $failed
