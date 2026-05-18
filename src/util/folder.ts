/**
 * Strip Liquid template segments from a folder path so it can be passed to
 * `dv.pages('"FOLDER"')` (which doesn't understand templates).
 *
 *   "Moments/{{date:YYYY}}"     → "Moments"
 *   "Facts/People"              → "Facts/People"
 *   "{{date:YYYY}}/Moments"     → ""              (whole-vault, slow but correct)
 *   ""                          → ""
 */
export function stripTemplateSegments(folder: string | undefined): string {
	if (!folder) return "";
	const tagAt = folder.indexOf("{{");
	if (tagAt < 0) return folder.replace(/\/+$/, "");
	const prefix = folder.slice(0, tagAt);
	// Walk back to the last slash before the tag — anything beyond that
	// is partially-templated and must be dropped.
	const lastSlash = prefix.lastIndexOf("/");
	if (lastSlash < 0) return ""; // tag is in the first segment
	return prefix.slice(0, lastSlash).replace(/\/+$/, "");
}
