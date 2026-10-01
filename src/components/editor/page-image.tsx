"use client";

import type { PageImage } from "@/lib/pdf-pages";

/**
 * One rendered page, as an image.
 *
 * Width is driven entirely by CSS, so zooming and resizing cost nothing and
 * cannot disturb the render. The aspect ratio comes from the PNG's own
 * dimensions, which keeps the element's height correct before the image has
 * finished decoding and stops the overlay jumping.
 */
export function PageImageView({
  image,
  pageNumber,
  width,
}: {
  image: PageImage | null;
  pageNumber: number;
  width: number;
}) {
  if (!image) {
    return (
      <div
        style={{ width, aspectRatio: "1 / 1.414" }}
        className="flex items-center justify-center bg-surface-muted text-xs text-muted-foreground"
      >
        Rendering page {pageNumber}…
      </div>
    );
  }

  return (
    /* A blob URL for an image rendered in this browser moments ago; next/image
       has nothing to contribute and cannot process a blob. */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt=""
      width={image.pxWidth}
      height={image.pxHeight}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      style={{ width, height: (width * image.pxHeight) / image.pxWidth }}
      className="block select-none bg-white"
    />
  );
}
