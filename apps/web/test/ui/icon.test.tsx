// F-215 the icon registry and Icon. TP-11.26.
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { Icon } from "../../src/ui/icons/Icon.js";

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("Icon rendered no <svg>");
  return svg;
}

describe("TP-11.26: Icon (F-215)", () => {
  it('TP-11.26: <Icon name="chevron-end"/> is aria-hidden, mirrored in RTL (data-rtl-probe="mirror", class rtl:-scale-x-100)', () => {
    const { container } = render(() => <Icon name="chevron-end" />);
    const svg = svgOf(container);

    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("data-rtl-probe")).toBe("mirror");
    expect(svg.classList.contains("rtl:-scale-x-100")).toBe(true);
  });

  it('TP-11.26: <Icon name="check" label="Done"/> is role="img" with aria-label "Done", not mirrored (data-rtl-probe="no-mirror")', () => {
    const { container } = render(() => <Icon name="check" label="Done" />);
    const svg = svgOf(container);

    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Done");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.getAttribute("data-rtl-probe")).toBe("no-mirror");
    expect(svg.classList.contains("rtl:-scale-x-100")).toBe(false);
  });
});
