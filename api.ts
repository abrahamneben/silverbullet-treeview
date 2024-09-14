import { editor, system } from "$sb/syscalls.ts";
import { PageMeta } from "$sb/types.ts";
import { PLUG_DISPLAY_NAME, TreeViewConfig } from "./config.ts";
import { filterPagesByFunction } from "./filters/filterByFunction.ts";
import { filterPagesByRegex } from "./filters/filterByRegex.ts";
import { filterPagesByTags } from "./filters/filterByTags.ts";

export type NodeData = {
  /**
   * The complete page or folder name.
   */
  name: string;

  /**
   * The name to display in the node to the user (generally the last
   * portion of the `name`)
   */
  title: string;

  /**
   * True if this node represents the current active page
   */
  isCurrentPage?: boolean;

  nodeType: string;
};

export type PageData = PageMeta & NodeData & {
  nodeType: "page";
};

export type FolderData = NodeData & {
  nodeType: "folder";
};

export type TreeNode = {
  data: PageData | FolderData;
  nodes: TreeNode[];
};

export type TreeShortcutPagesType = {
  prevPage: string;
  nextPage: string;
};

/* Clamp a number within bounds. */
function clamp(val: number, low: number, high: number)
{
  if (val < low)
  {
    return low;
  } else if (val > high)
  {
    return high;
  }
  else {
    return val;
  }
}

/**
 * Find pages that treeview keyboard shortcuts will point to.
 */
function findTreeShortcutPages(pages: PageMeta[], currentPage: PageMeta): TreeShortcutPagesType {

  // Get index of current page.
  const currentPageIndex: number = pages.findIndex(p => p.name === currentPage);

  return {
    prevPage: pages[clamp(currentPageIndex - 1, 0, pages.length - 1)].name,
    nextPage: pages[clamp(currentPageIndex + 1, 0, pages.length - 1)].name,
  }
}

/**
 * Generates a TreeNode array from the list of pages in the current space.
 */
export async function getPageTree(config: TreeViewConfig) {
  const currentPage = await editor.getCurrentPage();
  // The index plug's `queryObjects` function is used so that we include the
  // page tags -- `space.listPages()` does not populate those attributes.
  let pages = await system.invokeFunction(
    "index.queryObjects",
    "page",
  ) as PageMeta[];

  const root = { nodes: [] as TreeNode[] };

  if (config.pageExcludeRegex) {
    const deprecationWarning = `${PLUG_DISPLAY_NAME}:
\`pageExcludeRegex\` setting is deprecated. Please use \`exclusions\`:

\`\`\`yaml
treeview:
  exclusions:
  - type: regex
    rule: "${config.pageExcludeRegex}"
\`\`\`
    `;
    console.warn(deprecationWarning);
    pages = filterPagesByRegex(pages, {
      rule: config.pageExcludeRegex,
      negate: false,
    });
  }

  if (config.exclusions) {
    for (const exclusion of config.exclusions) {
      switch (exclusion.type) {
        case "regex": {
          pages = filterPagesByRegex(pages, exclusion);
          break;
        }
        case "tags": {
          pages = filterPagesByTags(pages, exclusion);
          break;
        }
        case "space-function": {
          pages = await filterPagesByFunction(pages, exclusion);
          break;
        }
      }
    }
  }

  pages.sort((a, b) => a.name.localeCompare(b.name));

  const treeShortcutPages: TreeShortcutPagesType = findTreeShortcutPages(pages, currentPage);

  pages.forEach((page) => {
    page.name.split("/").reduce((parent, title, currentIndex, parts) => {
      const isLeaf = parts.length - 1 === currentIndex;
      let node = parent.nodes.find((child) => child.data.title === title);
      if (node) {
        if (isLeaf && !("created" in node.data)) {
          // The node was found but is currently identified as a "folder",
          // so we need to change it to a "page" type.
          node.data = {
            ...page,
            title,
            isCurrentPage: currentPage === page.name,
            nodeType: "page",
          };
        }
        return node;
      }

      if (isLeaf) {
        // We're at the last part of the page name, so this reprents the page itself.
        node = {
          data: {
            ...page,
            title,
            isCurrentPage: currentPage === page.name,
            nodeType: "page",
          },
          nodes: [],
        };
      } else {
        // This is an intermediate part of the page name and a node doesn't exist
        // yet, so this represents a "folder" (and may be converted to a page
        // at some later iteration, if the page is found)
        const name = parts.slice(0, currentIndex + 1).join("/");
        node = {
          data: {
            title,
            // A folder can still be the "current page" if it's being created
            isCurrentPage: currentPage === name,
            name,
            nodeType: "folder",
          },
          nodes: [],
        };
      }

      parent.nodes.push(node);
      return node;
    }, root);
  });

  return {
    nodes: root.nodes,
    currentPage: currentPage,
    treeShortcutPages: treeShortcutPages,
  };
}
