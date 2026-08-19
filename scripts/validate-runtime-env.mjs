function appBaseUrlError(value) {
  if (!value) return null;
  if (value.trim() !== value) return 'APP_BASE_URL must not contain surrounding whitespace';

  let url;
  try {
    url = new URL(value);
  } catch {
    return 'APP_BASE_URL must be a valid absolute URL';
  }

  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    return 'APP_BASE_URL must be a bare http(s) origin without credentials, path, query or fragment';
  }
  return null;
}

const error = appBaseUrlError(process.env.APP_BASE_URL || '');
if (error) {
  console.error(error);
  process.exit(1);
}

export { appBaseUrlError };
