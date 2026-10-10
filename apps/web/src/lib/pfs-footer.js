/**
 * The shared Profullstack footer (@profullstack/footer): links, copyright and the
 * webring, from the package's @latest template, so a release of the package
 * reaches this site without a redeploy.
 *
 * Pages are built as synchronous template strings, so this returns the last
 * footer rendered and refreshes it in the background on each use (the package
 * caches the template for an hour). Until the first refresh lands it is the
 * template from the installed package.
 */
import { footerHtml, footerHtmlSync } from '@profullstack/footer';

const options = {
  site: 'https://bg0ne.com/',
  links: [{ label: 'Source', href: 'https://github.com/profullstack/bg0ne.com' }],
  tagline: 'Open source, MIT licensed',
};

let latest = footerHtmlSync(options);

export function pfsFooter() {
  footerHtml(options)
    .then((html) => {
      latest = html;
    })
    .catch(() => {});
  return latest;
}
