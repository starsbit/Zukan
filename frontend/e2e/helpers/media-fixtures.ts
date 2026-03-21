const BLUE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGNkYPjPAANMcBZeDgAx0wEH1s7nlgAAAABJRU5ErkJggg==';
const BLUE_PNG_ALT_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAIAAAACDbGyAAAAE0lEQVR4nGNkYPjHgASYkDlk8AFORgEIz3vsPwAAAABJRU5ErkJggg==';
const RED_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGP8z4AATEhsPBwAM9EBBzDn4UwAAAAASUVORK5CYII=';

export function bluePngFile(name = 'blue-upload.png', variant: 'primary' | 'secondary' = 'primary') {
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(variant === 'primary' ? BLUE_PNG_BASE64 : BLUE_PNG_ALT_BASE64, 'base64')
  };
}

export function redPngFile(name = 'red-upload.png') {
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(RED_PNG_BASE64, 'base64')
  };
}
