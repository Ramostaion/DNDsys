import { describe, expect, it } from 'vitest';
import { detectAudioMime } from './room-audio.js';

describe('音频扩展名和实际容器', () => {
  it('识别常见音频容器', () => {
    expect(detectAudioMime(Buffer.from('ID3\0\0\0'), '背景.MP3')).toBe('audio/mpeg');
    expect(detectAudioMime(Buffer.from([0xff, 0xfb, 0x90, 0x64]), 'ambient.mp3')).toBe('audio/mpeg');
    expect(detectAudioMime(Buffer.from('RIFF0000WAVEfmt '), 'sound.wav')).toBe('audio/wav');
    expect(detectAudioMime(Buffer.from('OggS'), 'sound.ogg')).toBe('audio/ogg');
    expect(detectAudioMime(Buffer.from('0000ftypM4A '), 'sound.m4a')).toBe('audio/mp4');
    expect(detectAudioMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'sound.webm')).toBe('audio/webm');
  });
  it('不接收改名图片、脚本、错误容器或空文件', () => {
    for (const [bytes, name] of [
      [Buffer.from('<script>'), 'track.mp3'],
      [Buffer.from('RIFF0000WEBP'), 'track.wav'],
      [Buffer.from('OggS'), 'track.mp3'],
      [Buffer.alloc(0), 'empty.wav'],
    ] as const)
      expect(() => detectAudioMime(bytes, name)).toThrow('音频格式无效');
  });
});
