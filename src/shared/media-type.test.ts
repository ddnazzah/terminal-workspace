import { describe, expect, test } from 'vitest'
import { mediaKindFor, mimeTypeFor } from './media-type'

describe('mediaKindFor', () => {
  test('detects raster images', () => {
    for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', 'a.ico', 'a.avif']) {
      expect(mediaKindFor(name), name).toBe('image')
    }
  })

  test('treats svg as its own kind so the source stays viewable', () => {
    expect(mediaKindFor('logo.svg')).toBe('svg')
  })

  test('detects video', () => {
    for (const name of ['a.mp4', 'a.webm', 'a.ogv', 'a.mov', 'a.mkv']) {
      expect(mediaKindFor(name), name).toBe('video')
    }
  })

  test('detects audio', () => {
    for (const name of ['a.mp3', 'a.wav', 'a.ogg', 'a.flac', 'a.m4a', 'a.aac']) {
      expect(mediaKindFor(name), name).toBe('audio')
    }
  })

  test('detects pdf', () => {
    expect(mediaKindFor('doc.pdf')).toBe('pdf')
  })

  test('returns null for text and code files', () => {
    for (const name of ['a.ts', 'a.md', 'README', 'a.json']) {
      expect(mediaKindFor(name), name).toBeNull()
    }
  })

  test('is case insensitive', () => {
    expect(mediaKindFor('PHOTO.PNG')).toBe('image')
    expect(mediaKindFor('Clip.MP4')).toBe('video')
  })

  test('uses the full path basename, not a directory that looks like an extension', () => {
    expect(mediaKindFor('some.png/notes.txt')).toBeNull()
    expect(mediaKindFor('assets/icons/logo.svg')).toBe('svg')
  })

  test('returns null for a dotfile with no extension', () => {
    expect(mediaKindFor('.gitignore')).toBeNull()
  })
})

describe('mimeTypeFor', () => {
  test('maps common images', () => {
    expect(mimeTypeFor('a.png')).toBe('image/png')
    expect(mimeTypeFor('a.jpg')).toBe('image/jpeg')
    expect(mimeTypeFor('a.jpeg')).toBe('image/jpeg')
    expect(mimeTypeFor('a.svg')).toBe('image/svg+xml')
  })

  test('maps media and documents', () => {
    expect(mimeTypeFor('a.mp4')).toBe('video/mp4')
    expect(mimeTypeFor('a.mp3')).toBe('audio/mpeg')
    expect(mimeTypeFor('a.pdf')).toBe('application/pdf')
  })

  test('falls back to a generic binary type', () => {
    expect(mimeTypeFor('a.unknownext')).toBe('application/octet-stream')
  })
})
