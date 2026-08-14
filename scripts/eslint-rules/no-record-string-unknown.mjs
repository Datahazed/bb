export const noRecordStringUnknownRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a data-specific type instead of a broad unknown record.",
    },
    schema: [],
    messages: {
      useAccurateType:
        "Replace this broad unknown record with a type that describes the data.",
    },
  },
  create(context) {
    return {
      TSTypeReference(node) {
        const typeArguments = node.typeArguments?.params;
        if (
          node.typeName.type === "Identifier" &&
          node.typeName.name === "Record" &&
          typeArguments?.length === 2 &&
          typeArguments[0]?.type === "TSStringKeyword" &&
          typeArguments[1]?.type === "TSUnknownKeyword"
        ) {
          context.report({ node, messageId: "useAccurateType" });
        }
      },
    };
  },
};

export const bbTypeRules = {
  rules: {
    "no-record-string-unknown": noRecordStringUnknownRule,
  },
};
