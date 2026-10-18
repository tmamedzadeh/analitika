<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Daily brief screens share a browser-safe in-memory context and reusable editor; this is a frontend prototype, not persisted or connected to the document backend.
- The homepage is the daily briefs index; analytics keeps its own /axtaris route, and brief edit routes are un-nested from the detail page.
