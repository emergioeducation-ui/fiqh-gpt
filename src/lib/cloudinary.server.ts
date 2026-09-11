/** Server-only Cloudinary helpers (REST, no SDK — Worker friendly). */

export type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string };

export function cloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env["CLOUDINARY_CLOUD_NAME"];
  const apiKey = process.env["CLOUDINARY_API_KEY"];
  const apiSecret = process.env["CLOUDINARY_API_SECRET"];
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cloudinary signature: sorted params joined as k=v, then the api secret appended. */
export async function signParams(
  params: Record<string, string | number>,
  apiSecret: string,
): Promise<string> {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return sha1Hex(`${toSign}${apiSecret}`);
}

export type UploadResult = { secureUrl: string; publicId: string; bytes: number; format?: string };

/** Uploads a file (as raw resource) to Cloudinary from the server. */
export async function uploadToCloudinary(
  file: { name: string; type: string; bytes: ArrayBuffer },
  folder = "fiqhgpt/kithabs",
): Promise<UploadResult> {
  const config = cloudinaryConfig();
  if (!config) throw new Error("Cloudinary is not configured. Add the Cloudinary keys to enable uploads.");

  const timestamp = Math.floor(Date.now() / 1000);
  const publicIdBase = `${Date.now()}-${file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_")}`.slice(0, 90);
  const signature = await signParams({ folder, public_id: publicIdBase, timestamp }, config.apiSecret);

  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: file.type || "application/octet-stream" }), file.name);
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicIdBase);
  form.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/raw/upload`, {
    method: "POST",
    body: form,
  });
  const json = (await res.json()) as {
    secure_url?: string;
    public_id?: string;
    bytes?: number;
    format?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.secure_url || !json.public_id) {
    throw new Error(`Cloudinary upload failed: ${json.error?.message ?? res.status}`);
  }
  return {
    secureUrl: json.secure_url,
    publicId: json.public_id,
    bytes: json.bytes ?? 0,
    format: json.format ?? "raw",
  };
}

export async function deleteFromCloudinary(publicId: string): Promise<void> {
  const config = cloudinaryConfig();
  if (!config || !publicId) return;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signParams({ public_id: publicId, timestamp }, config.apiSecret);
  const form = new FormData();
  form.append("public_id", publicId);
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/raw/destroy`, {
    method: "POST",
    body: form,
  });
}
