"""Lattice local formula OCR. Only pinned, verified ONNX/tokenizer assets load."""
import json
import pathlib
import socket
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'site-packages'))

def no_network(*_args, **_kwargs):
    raise RuntimeError('Network is disabled during local formula recognition')

def prepare_image(image):
    """Match the pinned DeiT processor; preserve the whole formula crop."""
    import numpy as np
    from PIL import Image, ImageOps
    if image.width <= 0 or image.height <= 0 or image.width * image.height > 16000000:
        raise ValueError('OCR_IMAGE_SIZE')
    image = ImageOps.exif_transpose(image).convert('RGBA')
    white = Image.new('RGBA', image.size, (255, 255, 255, 255))
    image = Image.alpha_composite(white, image).convert('RGB')
    extrema = ImageOps.grayscale(image).getextrema()
    if extrema[0] == extrema[1]:
        raise ValueError('OCR_EMPTY_IMAGE')
    image = image.resize((384, 384), Image.Resampling.BICUBIC)
    pixels = np.asarray(image, dtype=np.float32) / np.float32(255)
    pixels = (pixels - np.float32(0.5)) / np.float32(0.5)
    return pixels.transpose(2, 0, 1)[None]


def decode_formula(encoder, decoder, tokenizer, pixels, bos=1, eos=2, max_tokens=1024, timeout_seconds=75):
    """Greedy official generation; never invent an EOS or hide truncation."""
    import numpy as np
    started = time.monotonic()
    hidden = encoder.run(None, {'pixel_values': pixels})[0]
    tokens = [bos]
    ended = False
    for _ in range(max_tokens - 1):
        if time.monotonic() - started > timeout_seconds:
            raise ValueError('OCR_TIMEOUT')
        logits = decoder.run(None, {
            'input_ids': np.asarray([tokens], dtype=np.int64),
            'encoder_hidden_states': hidden,
        })[0]
        if not np.all(np.isfinite(logits[0, -1])):
            raise ValueError('OCR_OUTPUT')
        token = int(np.argmax(logits[0, -1]))
        # The fixed tokenizer reserves 0..4 for PAD/BOS/EOS/UNK/MASK. Only EOS
        # may terminate generated content; silent removal would hide lost math.
        if token in (0,1,3,4):
            raise ValueError('OCR_SPECIAL_TOKEN')
        tokens.append(token)
        if token == eos:
            ended = True
            break
    latex = tokenizer.decode(tokens, skip_special_tokens=True).strip()
    if not latex:
        raise ValueError('OCR_EMPTY')
    return {'latex': latex, 'endedWithEos': ended, 'truncated': not ended,
            'tokenCount': len(tokens), 'elapsedSeconds': time.monotonic() - started,
            'engine': 'pix2text-mfr-1.5'}


def load_engine():
    import onnxruntime as ort
    from tokenizers import Tokenizer
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    encoder = ort.InferenceSession(str(ROOT / 'models/encoder_model.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    decoder = ort.InferenceSession(str(ROOT / 'models/decoder_model.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    tokenizer_data = json.loads((ROOT / 'models/tokenizer.json').read_text('utf8'))
    # tokenizers 0.13 uses string merges; current HF serialization uses pairs.
    # Convert only serialization in memory. Vocabulary IDs/decoding are unchanged.
    merges = tokenizer_data['model']['merges']
    if merges and isinstance(merges[0], list):
        if not all(len(pair) == 2 and all(isinstance(token, str) for token in pair) for pair in merges):
            raise ValueError('OCR_TOKENIZER')
        tokenizer_data['model']['merges'] = [' '.join(pair) for pair in merges]
    tokenizer = Tokenizer.from_str(json.dumps(tokenizer_data))
    return encoder, decoder, tokenizer


def main():
    socket.socket.connect = no_network
    socket.socket.connect_ex = no_network
    socket.create_connection = no_network
    try:
        if len(sys.argv) != 2:
            raise ValueError('OCR_ARGUMENTS')
        encoder, decoder, tokenizer = load_engine()
        if sys.argv[1] == '--health':
            print(json.dumps({'ready': True, 'engine': 'pix2text-mfr-1.5'}))
            return
        from PIL import Image
        with Image.open(sys.argv[1]) as image:
            pixels = prepare_image(image)
        print(json.dumps(decode_formula(encoder, decoder, tokenizer, pixels), ensure_ascii=True))
    except Exception as error:
        # No source paths, formula contents or process environment in diagnostics.
        code = str(error) if isinstance(error, ValueError) and str(error).startswith('OCR_') else type(error).__name__
        print(json.dumps({'error': code}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
