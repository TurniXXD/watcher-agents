import { access, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { chunkSpokenText } from '../utils/audio-chunks.js';
import { PiperLocalTtsProvider } from '../piper-tts.js';
import type { ProcessRunner } from '../utils/process-runner.js';
import type { TtsInput } from '../tts.js';
import { czechCalendarVoice, piperVoices } from '../voice-registry.js';

describe('Piper audio pipeline', () => {
  it('uses verified model identifiers and natural chunk boundaries', () => {
    expect(Object.values(piperVoices).map(({ modelId }) => modelId)).toEqual([
      'en_US-amy-medium',
      'en_US-hfc_female-medium',
      'en_US-hfc_male-medium',
    ]);
    expect(czechCalendarVoice.modelId).toBe('cs_CZ-jirka-medium');
    expect(
      chunkSpokenText(
        'First sentence. Second sentence.\n\nA separate paragraph.',
        100,
      ),
    ).toEqual(['First sentence. Second sentence. A separate paragraph.']);
    expect(
      chunkSpokenText(`${'Long sentence words '.repeat(12)}. Next.`, 100),
    ).toHaveLength(4);
  });

  it('renders chunks sequentially, creates Opus, measures it, and cleans up', async () => {
    const commands: Array<{
      executable: string;
      arguments_: readonly string[];
      stdin?: string;
    }> = [];
    let temporaryDirectory = '';
    const run: ProcessRunner = async (
      executable: string,
      arguments_: readonly string[],
      _timeoutMs: number,
      stdin?: string,
    ) => {
      commands.push({ executable, arguments_, ...(stdin ? { stdin } : {}) });
      if (arguments_[1] === 'piper') {
        const output = arguments_[arguments_.indexOf('-f') + 1]!;
        temporaryDirectory = output.slice(0, output.lastIndexOf('/'));
        await writeFile(output, 'fake wav');
      } else if (executable === '/usr/bin/ffmpeg') {
        await writeFile(arguments_.at(-1)!, 'fake ogg');
      } else if (executable === '/usr/bin/ffprobe') {
        return { stdout: '12.75\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    let clock = 1_000;
    const provider = new PiperLocalTtsProvider({
      dataDirectory: '/models',
      pythonExecutable: '/usr/bin/python3',
      ffmpegExecutable: '/usr/bin/ffmpeg',
      ffprobeExecutable: '/usr/bin/ffprobe',
      chunkCharacters: 100,
      run,
      now: () => {
        clock += 250;
        return clock;
      },
    });

    const result = await provider.generateSpeech({
      text: 'Good morning. Porada týmu. Markets are quiet.',
      language: 'en',
      voice: 'hfc_male',
      segments: [
        { text: 'Good morning.', language: 'en' },
        { text: 'Porada týmu.', language: 'cs' },
        { text: 'Markets are quiet.', language: 'en' },
      ],
    });

    expect(result).toMatchObject({
      mimeType: 'audio/ogg',
      fileName: 'morning-briefing-hfc_male.ogg',
      voice: 'hfc_male',
      chunkCount: 3,
      generationDurationMs: 250,
      audioDurationSeconds: 12.75,
    });
    expect(Buffer.from(result.audio).toString()).toBe('fake ogg');
    expect(commands[0]?.executable).toBe('/usr/bin/python3');
    expect(commands[0]?.arguments_).toContain('piper');
    expect(commands[0]?.arguments_).toContain('/models');
    expect(commands[0]?.arguments_).toContain('en_US-hfc_male-medium');
    expect(commands[0]?.arguments_).not.toContain('Good morning.');
    expect(commands[0]?.stdin).toBe('Good morning.');
    expect(commands[1]?.arguments_).toContain('cs_CZ-jirka-medium');
    expect(commands[1]?.stdin).toBe('Porada týmu.');
    expect(commands[2]?.arguments_).toContain('en_US-hfc_male-medium');
    expect(commands[2]?.stdin).toBe('Markets are quiet.');
    expect(commands[3]?.arguments_).toContain('libopus');
    expect(commands[3]?.arguments_).toContain('48k');
    expect(commands[3]?.arguments_).toContain('voip');
    expect(commands[3]?.arguments_).toContain('ogg');
    await expect(access(temporaryDirectory)).rejects.toThrow();
  });

  it('rejects unsupported languages before starting Piper', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const provider = new PiperLocalTtsProvider({
      dataDirectory: '/models',
      run,
    });
    await expect(
      provider.generateSpeech({
        text: 'Hallo',
        language: 'de',
        voice: 'amy',
      } as unknown as TtsInput),
    ).rejects.toThrow(/not supported/);
    expect(run).not.toHaveBeenCalled();
  });
});
