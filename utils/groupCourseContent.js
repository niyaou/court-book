"use strict";
// Frontend-only format. The unchanged API stores this HTML in description.
// The marker distinguishes newly encoded content from literal legacy text.
const HTML_MARKER = "<!--group-course-rich-text:v1-->";
const MAX_TEXT = 20000;
const MAX_OPS = 10000;
function normalize(delta) {
  if (!delta || !Array.isArray(delta.ops) || delta.ops.length > MAX_OPS)
    throw new Error("课程排版数据无效");
  let length = 0;
  const ops = [];
  for (const op of delta.ops) {
    if (!op || typeof op.insert !== "string" || op.retain != null || op.delete != null)
      throw new Error("教学详情仅支持文字排版，请移除图片等非文字内容");
    const insert = op.insert.replace(/\r\n?/g, "\n");
    length += insert.length;
    if (length > MAX_TEXT) throw new Error(`教学详情最多${MAX_TEXT}字`);
    if (!insert) continue;
    const source = op.attributes || {}, attributes = {};
    for (const name of ["bold", "italic", "underline"])
      if (source[name] === true) attributes[name] = true;
    if ([1, 2, 3].includes(source.header)) attributes.header = source.header;
    if (["ordered", "bullet"].includes(source.list)) attributes.list = source.list;
    if (["center", "right"].includes(source.align)) attributes.align = source.align;
    ops.push(Object.keys(attributes).length ? { insert, attributes } : { insert });
  }
  return { ops };
}
function plainText(delta) {
  return delta.ops.map((op) => op.insert).join("").trim();
}
function fromText(text) {
  // Database field editors may store a literal backslash+n instead of a newline.
  // Decode only line breaks in legacy plain text, not arbitrary JSON escapes or HTML.
  const value = typeof text === "string"
    ? text.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r\n?/g, "\n") : "";
  return { ops: [{ insert: value.endsWith("\n") ? value : value + "\n" }] };
}
function storedHtml(description) {
  return typeof description === "string" && description.startsWith(HTML_MARKER)
    ? description.slice(HTML_MARKER.length) : null;
}
function editorContents(value) {
  if (value.editorDelta != null) return { delta: normalize(value.editorDelta) };
  const html = storedHtml(value.description);
  return html == null ? { delta: fromText(value.description) } : { html };
}
function deltaNodes(delta) {
  const result = [];
  let children = [], list = null;
  const flush = (attributes = {}) => {
    const listName = attributes.list === "ordered" ? "ol" : attributes.list === "bullet" ? "ul" : null;
    const styles = ["margin:0", "min-height:1.8em", "line-height:1.8", "white-space:pre-wrap", "word-wrap:break-word"];
    if (attributes.align) styles.push(`text-align:${attributes.align}`);
    if (attributes.header) styles.push(`font-size:${[0, 1.6, 1.35, 1.15][attributes.header]}em`, "font-weight:bold");
    const node = {
      name: listName ? "li" : attributes.header ? `h${attributes.header}` : "p", attrs: { style: styles.join(";") },
      children: children.length ? children : [{ name: "br", children: [] }],
    };
    if (listName) {
      if (!list || list.name !== listName) {
        list = { name: listName, attrs: { style: `margin:0;padding-left:1.8em;list-style-type:${listName === "ol" ? "decimal" : "disc"}` }, children: [] };
        result.push(list);
      }
      list.children.push(node);
    } else {
      list = null;
      result.push(node);
    }
    children = [];
  };
  for (const op of delta.ops) {
    const attributes = op.attributes || {};
    const parts = op.insert.split("\n");
    parts.forEach((part, index) => {
      if (part) {
        const styles = [];
        if (attributes.bold) styles.push("font-weight:bold");
        if (attributes.italic) styles.push("font-style:italic");
        if (attributes.underline) styles.push("text-decoration:underline");
        const text = { type: "text", text: part };
        children.push(styles.length ? { name: "span", attrs: { style: styles.join(";") }, children: [text] } : text);
      }
      if (index < parts.length - 1) flush(attributes);
    });
  }
  if (children.length) flush();
  return result;
}
function nodes(value) {
  const html = storedHtml(value.description);
  return html == null ? deltaNodes(fromText(value.description)) : html;
}
const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function nodeHtml(node) {
  if (node.type === "text") return escapeHtml(node.text);
  if (node.name === "br") return "<br>";
  const style = node.attrs && node.attrs.style;
  return `<${node.name}${style ? ` style="${escapeHtml(style)}"` : ""}>` +
    node.children.map(nodeHtml).join("") + `</${node.name}>`;
}
function encode(value) {
  const delta = normalize(value);
  if (!plainText(delta)) throw new Error("请填写教学详情");
  // Only locally generated tags/styles are serialized; editor HTML is not trusted.
  const description = HTML_MARKER + deltaNodes(delta).map(nodeHtml).join("");
  if (description.length > MAX_TEXT)
    throw new Error("教学详情过长，请精简文字或排版后重试");
  return description;
}
module.exports = { MAX_TEXT, normalize, plainText, fromText, editorContents, encode, nodes };
