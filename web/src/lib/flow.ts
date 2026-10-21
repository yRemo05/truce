/** Pass-the-phone mode travels in the URL, so a refresh keeps it. */
const PASS = 'pass';

export const isPassMode = (search: string) => new URLSearchParams(search).get('play') === PASS;
export const withPass = (path: string, pass: boolean) => (pass ? `${path}?play=${PASS}` : path);
