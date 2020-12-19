export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ServiceConfig = {
  host: string;
  path: string;
}

export type Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
}