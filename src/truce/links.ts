/**
 * Where to act on a pick, built from the ids Qloo carries: watch the film,
 * play the artist, find and call the restaurant. Ids are URL-encoded and any
 * address Qloo gives is kept only if it is plain http(s), so nothing from the
 * data can become a script link.
 */
import type { Link } from '../contract';
import type { Entity } from '../qloo/schemas';
import type { Slot } from './types';

const enc = encodeURIComponent;

/** An http(s) URL as given, or null. */
function webUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Digits and a leading + only. */
const phoneNumber = (raw: string | null) => {
  const clean = raw?.replace(/[^\d+]/g, '') ?? '';
  return /^\+?\d{5,16}$/.test(clean) ? clean : null;
};

export function linksOf(entity: Entity, slot: Slot): Link[] {
  const ext = entity.external;
  const links: Link[] = [];
  if (slot === 'film') {
    if (ext.imdb && /^tt\d+$/.test(ext.imdb)) links.push({ kind: 'imdb', label: 'IMDb', url: `https://www.imdb.com/title/${ext.imdb}/` });
    if (ext.letterboxd) links.push({ kind: 'letterboxd', label: 'Letterboxd', url: `https://letterboxd.com/film/${enc(ext.letterboxd)}/` });
    if (ext.netflix && /^\d+$/.test(ext.netflix)) links.push({ kind: 'netflix', label: 'Netflix', url: `https://www.netflix.com/title/${ext.netflix}` });
  } else if (slot === 'music') {
    if (ext.spotify && /^[A-Za-z0-9]+$/.test(ext.spotify)) {
      links.push({ kind: 'spotify', label: 'Spotify', url: `https://open.spotify.com/artist/${ext.spotify}` });
    }
  } else {
    const query = [entity.name, entity.address].filter(Boolean).join(', ');
    const place = entity.googlePlaceId ? `&query_place_id=${enc(entity.googlePlaceId)}` : '';
    links.push({ kind: 'maps', label: 'Map', url: `https://www.google.com/maps/search/?api=1&query=${enc(query)}${place}` });
    const website = webUrl(entity.website);
    if (website) links.push({ kind: 'website', label: 'Website', url: website });
    const menu = webUrl(entity.menuUrl);
    if (menu && menu !== website) links.push({ kind: 'menu', label: 'Menu', url: menu });
    const phone = phoneNumber(entity.phone);
    if (phone) links.push({ kind: 'phone', label: 'Call', url: `tel:${phone}` });
  }
  return links;
}
