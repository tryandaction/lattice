"""Deterministic CPU-runner contracts; synthetic arrays and fake sessions only."""
import contextlib,importlib.util,io,pathlib,sys,types,unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
runner_path=pathlib.Path(__file__).with_name('formula-ocr-runner.py')
with patch.dict(sys.modules,{'rapid_latex_ocr':types.SimpleNamespace(LaTeXOCR=lambda **kwargs:None)}),patch.object(sys,'argv',[str(runner_path),'--health']),contextlib.redirect_stdout(io.StringIO()):
    spec=importlib.util.spec_from_file_location('formula_runner',runner_path);runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class Encoder:
    def run(self,_outputs,inputs):return [inputs['pixel_values']]
class Decoder:
    def __init__(self,tokens):self.tokens=iter(tokens)
    def run(self,_outputs,inputs):
        token=next(self.tokens);logits=np.zeros((1,len(inputs['input_ids'][0]),8),np.float32);logits[0,-1,token]=10;return [logits]
class Tokenizer:
    def decode(self,tokens,skip_special_tokens):return 'x+y' if tokens else ''

class RunnerContracts(unittest.TestCase):
    def decode(self,tokens,limit=5,timeout=10):
        self.assertTrue(callable(getattr(runner,'decode_formula',None)),'Decoder must report real EOS and truncation')
        return runner.decode_formula(Encoder(),Decoder(tokens),Tokenizer(),np.zeros((1,3,384,384),np.float32),1,2,limit,timeout)
    def test_eos_metadata(self):
        result=self.decode([5,2]);self.assertEqual(result['latex'],'x+y');self.assertTrue(result['endedWithEos']);self.assertFalse(result['truncated']);self.assertEqual(result['tokenCount'],3)
    def test_token_limit_retains_partial_with_truncation(self):
        result=self.decode([5]*5,4);self.assertFalse(result['endedWithEos']);self.assertTrue(result['truncated']);self.assertEqual(result['tokenCount'],4)
    def test_unexpected_special_token_is_not_silently_removed(self):
        with self.assertRaisesRegex(ValueError,'OCR_SPECIAL_TOKEN'):self.decode([3,2])
    def test_time_budget_never_calls_model(self):
        with self.assertRaisesRegex(ValueError,'OCR_TIMEOUT'):self.decode([],timeout=-1)
    def test_empty_eos_is_not_a_formula(self):
        self.assertTrue(callable(getattr(runner,'decode_formula',None)),'Decoder contract is missing')
        with self.assertRaisesRegex(ValueError,'OCR_EMPTY'):
            runner.decode_formula(Encoder(),Decoder([2]),types.SimpleNamespace(decode=lambda *a,**kw:''),np.zeros((1,3,384,384),np.float32),1,2,5,10)
    def test_blank_rejected_and_rgba_composited_without_cropping(self):
        self.assertTrue(callable(getattr(runner,'prepare_image',None)),'Whole-formula preprocessing contract is missing')
        with self.assertRaisesRegex(ValueError,'OCR_EMPTY_IMAGE'):runner.prepare_image(Image.new('RGB',(64,64),'white'))
        image=Image.new('RGBA',(400,100),(255,255,255,0));image.paste((0,0,0,255),(10,10,390,90));pixels=runner.prepare_image(image)
        self.assertEqual(pixels.shape,(1,3,384,384));self.assertEqual(pixels.dtype,np.float32);self.assertEqual(float(pixels[0,0,0,0]),1.0);self.assertLess(float(pixels.min()),0)
    def test_image_dimension_limit(self):
        self.assertTrue(callable(getattr(runner,'prepare_image',None)),'Image bounds contract is missing')
        with self.assertRaisesRegex(ValueError,'OCR_IMAGE_SIZE'):runner.prepare_image(types.SimpleNamespace(width=20000,height=20000))

if __name__=='__main__':unittest.main()
