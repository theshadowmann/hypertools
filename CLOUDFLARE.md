# Cloudflare Pages

HyperTools deploys to Cloudflare Pages on every push to `main` (workflow: `.github/workflows/cloudflare-pages.yml`).

## One-time setup

1. Cloudflare dashboard → Workers & Pages → Create application → Pages.
2. API token: My Profile → API Tokens → Create Token → **Edit Cloudflare Workers**.
3. Account ID: Workers & Pages overview (right sidebar).
4. GitHub repo → Settings → Secrets and variables → Actions:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. Push to `main` or run the **Cloudflare Pages** workflow. Project name: `hypertools`.
6. Pages → hypertools → Custom domains → `hypertools.app` and `www.hypertools.app`.
7. Namecheap: switch nameservers to Cloudflare, or add the DNS records Cloudflare shows.

Azure SWA workflow remains as backup until cutover.
