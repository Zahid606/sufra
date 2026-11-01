import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/lib/useLocale';
import { Button, Spinner, cx, useToast } from '@/components/ui';

/**
 * Uploads to the public `menu` bucket under <restaurant_id>/..., which is
 * exactly the prefix the storage policy allows this tenant to write to — so a
 * manager cannot overwrite another restaurant's photos even by crafting a path.
 *
 * Large phone photos are downscaled in the browser before upload: a 4 MB
 * kitchen snapshot becomes ~150 KB, which matters on restaurant wifi and keeps
 * the guest menu fast.
 */
const MAX_EDGE = 1280;
const QUALITY = 0.82;

async function downscale(file: File): Promise<Blob> {
  if (file.type === 'image/svg+xml' || file.size < 180_000) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', QUALITY),
  );
  return blob && blob.size < file.size ? blob : file;
}

export function ImageUpload({
  value,
  onChange,
  restaurantId,
  folder = 'items',
  label,
  aspect = 'square',
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  restaurantId: string;
  folder?: string;
  label?: string;
  aspect?: 'square' | 'wide';
}) {
  const { t } = useLocale();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    setBusy(true);

    try {
      const blob = await downscale(file);
      const ext = blob.type === 'image/webp' ? 'webp' : (file.name.split('.').pop() || 'jpg');
      const path = `${restaurantId}/${folder}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;

      const { error } = await supabase.storage.from('menu').upload(path, blob, {
        contentType: blob.type,
        cacheControl: '31536000',
        upsert: false,
      });

      if (error) {
        push(t('errors.saveFailed'), 'error');
        return;
      }

      const { data } = supabase.storage.from('menu').getPublicUrl(path);
      onChange(data.publicUrl);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      {label ? <p className="label">{label}</p> : null}

      <div className="flex items-start gap-3">
        <div
          className={cx(
            'relative shrink-0 overflow-hidden rounded-xl bg-ink-100 ring-1 ring-ink-200',
            aspect === 'square' ? 'h-24 w-24' : 'h-24 w-40',
          )}
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-ink-300">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="9" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.5" />
                <path d="m5 17 4.5-4 3 2.5L16 12l3 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}

          {busy ? (
            <div className="absolute inset-0 grid place-items-center bg-white/75">
              <Spinner className="text-brand-600" />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? t('admin.uploading') : value ? t('admin.replacePhoto') : t('admin.uploadPhoto')}
          </Button>

          {value ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
              {t('admin.removePhoto')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
