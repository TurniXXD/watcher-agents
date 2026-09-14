import { chunkSpokenText, runProcess, type ProcessRunner } from '@watcher/core';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type AudioResult = {
  audio: Uint8Array;
  mimeType: 'audio/ogg';
  fileName: string;
  durationSeconds: number;
  chunkCount: number;
};

export type TTSProvider = { synthesize(text: string): Promise<AudioResult> };

export type PiperStudyTtsOptions = {
  dataDirectory: string;
  voice: string;
  pythonExecutable?: string;
  ffmpegExecutable?: string;
  ffprobeExecutable?: string;
  chunkCharacters?: number;
  run?: ProcessRunner;
};

const quotedFile = (path: string): string =>
  `file '${path.replaceAll("'", "'\\''")}'`;

export class PiperStudyTtsProvider implements TTSProvider {
  private readonly run: ProcessRunner;

  public constructor(private readonly options: PiperStudyTtsOptions) {
    this.run = options.run ?? runProcess;
  }

  public async synthesize(text: string): Promise<AudioResult> {
    const chunks = chunkSpokenText(text, this.options.chunkCharacters ?? 1_500);
    if (!chunks.length) throw new Error('Lecture script is empty');
    const directory = await mkdtemp(join(tmpdir(), 'watcher-study-'));
    try {
      const segments: string[] = [];
      for (const [index, chunk] of chunks.entries()) {
        const output = join(directory, `segment-${index}.wav`);
        await this.run(
          this.options.pythonExecutable ?? 'python3',
          [
            '-m',
            'piper',
            '--data-dir',
            this.options.dataDirectory,
            '-m',
            this.options.voice,
            '-f',
            output,
          ],
          300_000,
          chunk,
        );
        segments.push(output);
      }
      const manifest = join(directory, 'segments.txt');
      await writeFile(manifest, segments.map(quotedFile).join('\n'), {
        mode: 0o600,
      });
      const output = join(directory, 'lecture.ogg');
      await this.run(
        this.options.ffmpegExecutable ?? 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          manifest,
          '-af',
          'loudnorm=I=-16:TP=-1.5:LRA=11',
          '-c:a',
          'libopus',
          '-b:a',
          '48k',
          '-application',
          'voip',
          '-f',
          'ogg',
          '-y',
          output,
        ],
        300_000,
      );
      const probe = await this.run(
        this.options.ffprobeExecutable ?? 'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          output,
        ],
        30_000,
      );
      const durationSeconds = Number(probe.stdout.trim());
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
        throw new Error('Could not determine lecture audio duration');
      return {
        audio: await readFile(output),
        mimeType: 'audio/ogg',
        fileName: 'study-lecture.ogg',
        durationSeconds,
        chunkCount: chunks.length,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
