/**
 * Sanitize HTML output from marked() to prevent XSS.
 * Allows safe markdown-generated tags while stripping dangerous ones.
 */
const ALLOWED_TAGS = /^<\/?(p|br|strong|em|b|i|u|s|code|pre|blockquote|h[1-6]|ul|ol|li|a|hr|table|thead|tbody|tr|th|td|img|span|div|del|sup|sub)(\s|>|\/)/i;
const DANGEROUS_ATTR = /\s(on\w+|style|srcdoc|formaction)\s*=/gi;

export function sanitizeHtml(html) {
	if (!html) return '';
	return html.replace(/<[^>]+>/g, tag => {
		if (ALLOWED_TAGS.test(tag)) {
			return tag.replace(DANGEROUS_ATTR, ' data-removed=');
		}
		return tag.replace(/</g, '&lt;').replace(/>/g, '&gt;');
	});
}
