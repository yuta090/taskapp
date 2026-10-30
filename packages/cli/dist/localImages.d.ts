export interface UploadedImage {
    path: string;
    url: string;
}
export declare function uploadLocalImages(text: string, baseDir: string, upload: (absPath: string) => Promise<string>, exists?: (absPath: string) => boolean): Promise<{
    text: string;
    uploaded: UploadedImage[];
}>;
