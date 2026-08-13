import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/**
 * KaTeX, isolated behind a dynamic import.
 *
 * `rehype-katex` plus the KaTeX stylesheet weigh about 260 KB, and
 * `markdown-preview` renders on the thread route. A static import therefore
 * puts KaTeX on that route's preload set, even though almost no message
 * contains math. `useKatexRehypePlugin` in `markdown-preview.tsx` imports this
 * module only when a body can produce math.
 */
export { rehypeKatex };
