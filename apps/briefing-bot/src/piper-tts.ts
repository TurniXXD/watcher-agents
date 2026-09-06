import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { briefingVoiceIdSchema } from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';
import { chunkSpokenText } from './utils/audio-chunks.js';
import { runProcess, type ProcessRunner } from './utils/process-runner.js';
import type { TtsInput, TtsLanguage, TtsProvider, TtsResult } from './tts.js';
import { czechCalendarVoice, piperVoices } from './voice-registry.js';

export type PiperTtsOptions = {
  dataDirectory: string;
  pythonExecutable?: string;
  ffmpegExecutable?: string;
  ffprobeExecutable?: string;
  chunkCharacters?: number;
  timeoutMs?: number;
  keepTemporaryFiles?: boolean;
  run?: ProcessRunner;
  now?: () => number;
  logger?: WatcherLogger;
};

const concatEntry = (path: string): string =>
  `file '${path.replaceAll("'", "'\\''")}'`;

export class PiperLocalTtsProvider implements TtsProvider {
  private readonly run: ProcessRunner;
  private readonly now: () => number;

  public constructor(private readonly options: PiperTtsOptions) {
    this.run = options.run ?? runProcess;
    this.now = options.now ?? Date.now;
  }

  public async generateSpeech(input: TtsInput): Promise<TtsResult> {
    const voice = briefingVoiceIdSchema.parse(input.voice);
    const segments = input.segments?.length
      ? input.segments
      : [{ text: input.text, language: input.language }];
    const definitionFor = (language: TtsLanguage) => {
      if (language === 'en') return piperVoices[voice];
      if (language === 'cs') return czechCalendarVoice;
      throw new Error(`Piper language ${String(language)} is not supported`);
    };
    const chunks = segments.flatMap((segment) => {
      const definition = definitionFor(segment.language);
      return chunkSpokenText(
        segment.text.trim(),
        this.options.chunkCharacters ?? 1_200,
      ).map((text) => ({ definition, text }));
    });
    if (chunks.length === 0) throw new Error('TTS text must not be empty');
    const directory = await mkdtemp(join(tmpdir(), 'watcher-piper-'));
    const startedAt = this.now();
    this.options.logger?.info(
      {
        voice,
        segmentCount: segments.length,
        chunkCount: chunks.length,
        languages: [...new Set(segments.map(({ language }) => language))],
      },
      'Piper speech generation started',
    );
    try {
      const wavFiles: string[] = [];
      for (const [index, chunk] of chunks.entries()) {
        this.options.logger?.debug(
          {
            voice,
            chunk: index + 1,
            chunkCount: chunks.length,
            modelId: chunk.definition.modelId,
            characterCount: chunk.text.length,
          },
          'Generating Piper audio chunk',
        );
        const output = join(
          directory,
          `chunk-${String(index).padStart(3, '0')}.wav`,
        );
        await this.run(
          this.options.pythonExecutable ?? 'python3',
          [
            '-m',
            'piper',
            '--data-dir',
            this.options.dataDirectory,
            '-m',
            chunk.definition.modelId,
            '-f',
            output,
          ],
          this.options.timeoutMs ?? 300_000,
          chunk.text,
        );
        wavFiles.push(output);
      }
      const concatFile = join(directory, 'segments.txt');
      await writeFile(concatFile, wavFiles.map(concatEntry).join('\n'), {
        encoding: 'utf8',
        mode: 0o600,
      });
      const output = join(directory, 'briefing.ogg');
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
          concatFile,
          '-af',
          'loudnorm=I=-16:TP=-1.5:LRA=11',
          '-c:a',
          'libopus',
          '-b:a',
          '48k',
          '-application',
          'voip',
          '-y',
          output,
        ],
        this.options.timeoutMs ?? 300_000,
      );
      const duration = await this.run(
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
      const audioDurationSeconds = Number(duration.stdout.trim());
      if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) {
        throw new Error('ffprobe returned an invalid audio duration');
      }
      this.options.logger?.info(
        {
          voice,
          chunkCount: chunks.length,
          generationDurationMs: this.now() - startedAt,
          audioDurationSeconds,
        },
        'Piper speech generation completed',
      );
      return {
        audio: await readFile(output),
        mimeType: 'audio/ogg',
        fileName: `morning-briefing-${voice}.ogg`,
        voice,
        chunkCount: chunks.length,
        generationDurationMs: this.now() - startedAt,
        audioDurationSeconds,
      };
    } finally {
      if (!this.options.keepTemporaryFiles) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
