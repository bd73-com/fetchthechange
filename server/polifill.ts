import { File, Blob } from 'node:buffer';

// This fixes the "File is not defined" error on Node 18
// @ts-ignore
if (typeof global.File === 'undefined') {
  // @ts-ignore
  global.File = File;
}

// @ts-ignore
if (typeof global.Blob === 'undefined') {
  // @ts-ignore
  global.Blob = Blob;
}