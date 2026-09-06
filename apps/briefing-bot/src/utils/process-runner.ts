import { spawn } from 'node:child_process';

export type ProcessResult = {
  stdout: string;
  stderr: string;
};

export type ProcessRunner = (
  executable: string,
  arguments_: readonly string[],
  timeoutMs: number,
  stdin?: string,
) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = (
  executable,
  arguments_,
  timeoutMs,
  stdin,
) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...arguments_], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.end(stdin);
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${executable} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) resolve(result);
      else {
        reject(
          new Error(
            `${executable} exited with ${code}: ${result.stderr.replaceAll(/\s+/g, ' ').trim().slice(0, 500)}`,
          ),
        );
      }
    });
  });
