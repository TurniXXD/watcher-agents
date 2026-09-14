import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export type StudyStorage = {
  put(
    bucket: string,
    key: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<void>;
  get(bucket: string, key: string): Promise<Uint8Array>;
};

export type S3StudyStorageOptions = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export class S3StudyStorage implements StudyStorage {
  private readonly client: S3Client;

  public constructor(options: S3StudyStorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  public async put(
    bucket: string,
    key: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  public async get(bucket: string, key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!response.Body)
      throw new Error('Storage returned an empty object body');
    return response.Body.transformToByteArray();
  }
}
