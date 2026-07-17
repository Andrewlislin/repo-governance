const regexSpecial = /[|\\{}()[\]^$+?.]/g;

export function globToRegExp(glob) {
  let output = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          output += "(?:.*/)?";
        } else {
          output += ".*";
        }
      } else {
        output += "[^/]*";
      }
    } else {
      output += char.replace(regexSpecial, "\\$&");
    }
  }
  return new RegExp(`${output}$`);
}

export function matchesAny(path, patterns = []) {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}
