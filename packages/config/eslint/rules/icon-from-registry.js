// F-3: `budmon/icon-from-registry` (D-38 rule 6). Icons come only from the registry.

const REGISTRY = /apps\/web\/src\/ui\/icons\/registry\.ts$/;
const ICON_DIR = /apps\/web\/src\/ui\/icons\//;
const ICON_PACKAGE = /^(lucide-solid|@tabler\/icons-solidjs)(\/|$)|icons?/;

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      registry: "Use an icon from the registry (D-38 rule 6).",
    },
  },
  create(context) {
    const file = context.filename.split("\\").join("/");
    const inRegistry = REGISTRY.test(file);
    const inIcons = ICON_DIR.test(file);
    return {
      ImportDeclaration(node) {
        if (inRegistry) return;
        if (typeof node.source.value === "string" && ICON_PACKAGE.test(node.source.value)) {
          context.report({ node, messageId: "registry" });
        }
      },
      JSXOpeningElement(node) {
        if (inIcons) return;
        if (node.name.type === "JSXIdentifier" && node.name.name === "svg") {
          context.report({ node, messageId: "registry" });
        }
      },
    };
  },
};

export default rule;
