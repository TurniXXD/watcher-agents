import { escapeHtml, splitTelegramMessage } from '@watcher/telegram';
import { InputFile, type Api } from 'grammy';

export type TelegramVoiceInput = {
  audio: Uint8Array;
  fileName: string;
  caption: string;
};

export type BriefingTelegramTransport = {
  sendVoice: (chatId: string, input: TelegramVoiceInput) => Promise<string>;
  sendPlainText: (chatId: string, text: string) => Promise<string[]>;
};

export class GrammyBriefingTransport implements BriefingTelegramTransport {
  public constructor(private readonly api: Api) {}

  public async sendVoice(
    chatId: string,
    input: TelegramVoiceInput,
  ): Promise<string> {
    const message = await this.api.sendVoice(
      chatId,
      new InputFile(input.audio, input.fileName),
      { caption: input.caption, parse_mode: 'HTML' },
    );
    return String(message.message_id);
  }

  public async sendPlainText(chatId: string, text: string): Promise<string[]> {
    return this.sendParts(chatId, splitTelegramMessage(escapeHtml(text)));
  }

  private async sendParts(
    chatId: string,
    parts: readonly string[],
  ): Promise<string[]> {
    const messageIds: string[] = [];
    for (const part of parts) {
      const message = await this.api.sendMessage(chatId, part, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      messageIds.push(String(message.message_id));
    }
    return messageIds;
  }
}
