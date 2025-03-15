import { bangs } from "bang.ts";
import "global.css";

function noSearchDefaultPageRender() {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = `
  <div class="container">
    <h1>e108 Bangs</h1>
    <p>
      DuckDuckGo's bang redirects are too slow. Add the following URL as a custom search engine to your browser. Enables all of DuckDuckGo's 
      <a class="link" href="https://duckduckgo.com/bangs" target="_blank">bangs</a>.
    </p>
    <div class="url-container">
      <input type="text" id="urlInput" value="https://bang.e108.dev/?q=%s" readonly>
      <button class="copy-button" id="copyButton">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
        </svg>
      </button>
    </div>
  </div>
  <div class="footer">
    <a href="e108.dev" target="_blank">e108.dev</a> • 
    <a href="https://github.com/Q2x38b" target="_blank">e108</a> • 
    <a href="https://github.com/Q2x38b/simplified-bangs" target="_blank">github</a>
  </div>
  `;

  const copyButton = document.getElementById("copyButton");
  if (copyButton) {
    copyButton.addEventListener("click", function () {
      const urlInput = document.getElementById("urlInput") as HTMLInputElement;
      if (urlInput) {
        urlInput.select();
        urlInput.setSelectionRange(0, 99999);

        navigator.clipboard
          .writeText(urlInput.value)
          .then(() => {
            const originalSVG = this.innerHTML;
            this.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="green" stroke-width="2">
                <path d="M20 6L9 17l-5-5"></path>
              </svg>
            `;
            setTimeout(() => {
              this.innerHTML = originalSVG;
            }, 1000);
          })
          .catch((err) => {
            console.error("Failed to copy text: ", err);
          });
      }
    });
  }
}

const LS_DEFAULT_BANG = localStorage.getItem("default-bang") ?? "g";
const defaultBang = bangs.find((b) => b.t === LS_DEFAULT_BANG);

function getBangredirectUrl() {
  const url = new URL(window.location.href);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    noSearchDefaultPageRender();
    return null;
  }

  const match = query.match(/!(\S+)/i);
  const bangCandidate = match?.[1]?.toLowerCase();
  const selectedBang = bangs.find((b) => b.t === bangCandidate) ?? defaultBang;

  // Remove the bang from the query
  const cleanQuery = query.replace(/!\S+\s*/i, "").trim();

  const searchUrl = selectedBang?.u.replace(
    "{{{s}}}",
    encodeURIComponent(cleanQuery).replace(/%2F/g, "/")
  );
  if (!searchUrl) return null;

  return searchUrl;
}

function doRedirect() {
  const searchUrl = getBangredirectUrl();
  if (!searchUrl) return;
  window.location.replace(searchUrl);
}

doRedirect();
