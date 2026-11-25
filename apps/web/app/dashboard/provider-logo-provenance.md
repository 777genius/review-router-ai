# Provider mark provenance

The MiMo mark is the MiMo portion of the inline Xiaomi MiMo SVG wordmark served by
https://mimo.mi.com/ on 2026-10-26 (`viewBox="0 0 132 16"`, paths 10–18).
Its path data is preserved; the viewport selects the MiMo portion and the fill
uses `currentColor` for the surrounding interface. The source contains only path
geometry: no scripts, event handlers, external resources or embedded content.
The official favicon and MiMo Code SVG on the same site use the same wordmark.

Xiaomi retains the mark's rights; the website does not publish a separate open
asset license. This copy identifies the upstream provider and does not imply
endorsement. Website terms: https://mimo.mi.com/docs/terms/user-agreement .

OpenAI, Claude and OpenRouter geometry is reused from the existing
`provider-auth-logo.tsx`. Kimi and Grok geometry is reused from the existing
`account-identity.tsx` (originally sub2api PlatformIcon). Unknown identities use a neutral local mark.

## Official local assets (retrieved 2026-11-15)

- **MiniMax**: the colored symbol (first path and its original gradient) from the
  [official API documentation](https://platform.minimax.io/docs) header's
  [published SVG](https://mintcdn.com/minimax-cac98058/XYzsL2L2ynonu2Q_/logo/light.svg).
  The viewBox selects the symbol; path geometry and gradient colors are unchanged.
- **Z.ai / GLM**: the [official Z.ai website](https://z.ai/) links this
  [SVG favicon](https://z-cdn.chatglm.cn/z-ai/static/logo.svg). Geometry, fills and
  stroke are unchanged. Unused style declarations/groups were removed and the
  used declarations were flattened into explicit SVG attributes.
- **NVIDIA**: the complete vertical logo, including both eye and wordmark, from
  the [official brand page](https://www.nvidia.com/en-us/about-nvidia/legal-info/logo-brand-usage/)
  and its [published SVG](https://www.nvidia.com/content/nvidiaGDC/us/en_US/about-nvidia/legal-info/logo-brand-usage/_jcr_content/root/responsivegrid/nv_container_392921705/nv_container/nv_image.coreimg.svg/1776076920288/nvidia-logo-vert.svg).
  Original geometry and black/green colors are preserved. The viewport removes
  surrounding presentation-canvas whitespace while retaining clear space; a
  white background keeps the complete two-color logo legible in both themes.

These are provider-identification assets, not newly designed marks. The
respective brands retain their trademark/copyright rights; these sources do not
publish a separate open asset license. No endorsement or new license is claimed.
The copies contain only local SVG geometry/paint: no scripts, event handlers,
foreign content, embedded raster data, external references or remote requests.
The existing shared decorative-logo convention remains: adjacent provider text
owns the accessible name, images have empty alt text, and each SVG/image has a
brand title. The icon footprint is consistently 20 × 16 px inside the existing
24 px provider frame.

Original-source SHA-256:

- `minimax`: `90c43806b801dd6db9bf95613f9a5634cc83a1c7f303ea192eec37d985baa631`
- `zai`: `07a45e8e35b0b631ed2c68cd1cb041f9721b1ceeb0bd0e34f1459b0304a741c7`
- `nvidia`: `5347e5188c74204767d2d4daa17b59b5a18ccd7ad0a7281e7961a83c20c96808`
