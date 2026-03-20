export interface ImageAssetProps {
  name: string;
  src: string;
  w: number;
  h: number;
  mimeType: string;
  isAnimated: boolean;
}

export interface ImageRegionLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSizeLike {
  width: number;
  height: number;
}

export function buildImageAssetProps(input: {
  fileName: string;
  imageUrl: string;
  imageSize: ImageSizeLike;
  mimeType: string;
}): ImageAssetProps {
  return {
    name: input.fileName,
    src: input.imageUrl,
    w: input.imageSize.width,
    h: input.imageSize.height,
    mimeType: input.mimeType,
    isAnimated: false,
  };
}

export function shouldUpdateImageAsset(
  existingAsset: { type?: string; props?: ImageAssetProps | Partial<ImageAssetProps> | Record<string, unknown> } | null | undefined,
  nextProps: ImageAssetProps,
): boolean {
  if (!existingAsset || existingAsset.type !== 'image') {
    return false;
  }

  const props = existingAsset.props ?? {};

  return props.src !== nextProps.src ||
    props.w !== nextProps.w ||
    props.h !== nextProps.h ||
    props.mimeType !== nextProps.mimeType;
}

export function hasBackgroundShape(shapes: Array<{ id: string }>, backgroundShapeId: string): boolean {
  return shapes.some((shape) => shape.id === backgroundShapeId);
}

export function shouldRestoreImageBackground(input: {
  backgroundShape: unknown;
  backgroundAsset: unknown;
}): boolean {
  return !input.backgroundShape || !input.backgroundAsset;
}

export function getImageRegionCenter(region: ImageRegionLike, imageSize: ImageSizeLike): { x: number; y: number } {
  return {
    x: ((region.x + region.width / 2) / 100) * imageSize.width,
    y: ((region.y + region.height / 2) / 100) * imageSize.height,
  };
}
