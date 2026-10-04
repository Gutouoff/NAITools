export type DownloadStage = "idle" | "downloading" | "verifying" | "extracting" | "checking" | "complete" | "failed" | "cancelled";
export type DetectiveVariant = "full" | "light";
export interface DetectiveDownloadStatus {
  variant: DetectiveVariant;
  stage: DownloadStage; busy: boolean; directory: string; file: string;
  downloaded: number; total: number; bytesPerSecond: number; message: string;
  packages: { file: string; bytes: number; sha256: string; url: string }[];
  repository: string;
}
