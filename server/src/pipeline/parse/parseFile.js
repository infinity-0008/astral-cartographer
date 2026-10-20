import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { sha1 } from '../../utils/hash.js';
const traverse = traverseModule.default || traverseModule;

function memberPropertyName(node) {
  if (!node || node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  if (node.computed && ['StringLiteral', 'NumericLiteral'].includes(node.property?.type)) return String(node.property.value);
  return null;
}

function isModuleExportsTarget(node) {
  return node?.type === 'MemberExpression' && node.object?.type === 'Identifier' &&
    node.object.name === 'module' && memberPropertyName(node) === 'exports';
}

function nodeName(node, fallback = 'anonymous', parent = null) {
  if (parent?.type === 'AssignmentExpression') {
    if (isModuleExportsTarget(parent.left)) return 'default';
    if (parent.left?.type === 'MemberExpression') {
      const key = memberPropertyName(parent.left);
      if (key && (parent.left.object?.name === 'exports' || isModuleExportsTarget(parent.left.object))) return key;
    }
    if (parent.left?.type === 'Identifier') return parent.left.name;
  }
  if (node?.id?.name) return node.id.name;
  if (node?.key?.name) return node.key.name;
  if (node?.key?.value != null) return String(node.key.value);
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name;
  if (parent?.type === 'ObjectProperty' || parent?.type === 'ClassProperty') {
    const key = parent.computed ? null : (parent.key?.name ?? parent.key?.value);
    if (key != null) return String(key);
  }
  return fallback;
}

function computeComplexity(functionPath) {
  let score = 1;
  functionPath.traverse({
    Function(path) { path.skip(); },
    IfStatement() { score++; },
    ConditionalExpression() { score++; },
    ForStatement() { score++; },
    ForInStatement() { score++; },
    ForOfStatement() { score++; },
    WhileStatement() { score++; },
    DoWhileStatement() { score++; },
    SwitchCase(path) { if (path.node.test) score++; },
    CatchClause() { score++; },
    LogicalExpression(path) { if (['&&', '||', '??'].includes(path.node.operator)) score++; }
  });
  return score;
}

function topLevelComplexity(ast) {
  let score = 1;
  traverse(ast, {
    Function(path) { path.skip(); },
    IfStatement() { score++; }, ConditionalExpression() { score++; }, ForStatement() { score++; },
    ForInStatement() { score++; }, ForOfStatement() { score++; }, WhileStatement() { score++; },
    DoWhileStatement() { score++; }, SwitchCase(path) { if (path.node.test) score++; }, CatchClause() { score++; },
    LogicalExpression(path) { if (['&&', '||', '??'].includes(path.node.operator)) score++; }
  });
  return score;
}

function getImportBinding(binding) {
  if (!binding?.path) return null;
  const p = binding.path;
  if (p.isImportSpecifier?.()) {
    const source = p.parentPath?.node?.source?.value;
    const imported = p.node.imported?.name ?? p.node.imported?.value ?? 'default';
    return source ? { spec: source, importedName: String(imported) } : null;
  }
  if (p.isImportDefaultSpecifier?.() || p.isImportNamespaceSpecifier?.()) {
    const source = p.parentPath?.node?.source?.value;
    if (!source) return null;
    return { spec: source, importedName: p.isImportNamespaceSpecifier() ? '*' : 'default', namespace: p.isImportNamespaceSpecifier() };
  }
  // CommonJS require() and awaited dynamic imports are bindings too. Recognizing
  // these here allows `const api = require('./api'); api.run()` to resolve.
  if (p.isVariableDeclarator?.()) {
    let init = p.node.init;
    if (init?.type === 'AwaitExpression') init = init.argument;
    if (init?.type !== 'CallExpression') return null;
    const isRequire = init.callee?.type === 'Identifier' && init.callee.name === 'require';
    const isDynamicImport = init.callee?.type === 'Import';
    const spec = init.arguments?.[0]?.type === 'StringLiteral' ? init.arguments[0].value : null;
    if ((!isRequire && !isDynamicImport) || !spec) return null;
    if (p.node.id?.type === 'ObjectPattern') {
      const localName = binding.identifier?.name;
      for (const property of p.node.id.properties || []) {
        if (property.type !== 'ObjectProperty' || property.value?.type !== 'Identifier' || property.value.name !== localName) continue;
        const importedName = property.key?.name ?? property.key?.value;
        if (importedName != null) return { spec, importedName: String(importedName), namespace: false };
      }
      return null;
    }
    if (p.node.id?.type === 'Identifier') return { spec, importedName: '*', namespace: true };
  }
  return null;
}

export function parseFile(id, code) {
  const contentHash = sha1(code);
  const loc = code.split(/\r?\n/).filter(line => line.trim().length > 0).length;
  const sizeBytes = Buffer.byteLength(code, 'utf8');
  try {
    const ast = parse(code, {
      sourceType: 'unambiguous', tokens: true, errorRecovery: true, allowReturnOutsideFunction: true,
      plugins: ['jsx', 'typescript', 'dynamicImport', 'classProperties', 'decorators-legacy', 'optionalChaining', 'nullishCoalescingOperator']
    });
    const imports = [];
    const exports = new Set();
    const defaultExportNames = new Set();
    const functionMap = new WeakMap();
    const functions = [];
    const rawCalls = [];
    let serial = 0;

    const recordImport = (spec, kind, names, line) => {
      imports.push({ spec, kind, names: [...new Set(names)], line: line || 1, resolvedTo: null });
    };

    traverse(ast, {
      ImportDeclaration(path) {
        const names = path.node.specifiers.map(s => {
          if (s.type === 'ImportDefaultSpecifier') return 'default';
          if (s.type === 'ImportNamespaceSpecifier') return '*';
          return String(s.imported?.name ?? s.imported?.value ?? 'default');
        });
        recordImport(path.node.source.value, 'static', names, path.node.loc?.start.line);
      },
      ExportNamedDeclaration(path) {
        const n = path.node;
        if (n.source?.value) recordImport(n.source.value, 'reexport', n.specifiers.map(s => String(s.local?.name ?? s.local?.value ?? s.exported?.name ?? 'default')), n.loc?.start.line);
        if (n.declaration?.id?.name) exports.add(n.declaration.id.name);
        if (n.declaration?.declarations) for (const decl of n.declaration.declarations) if (decl.id?.name) exports.add(decl.id.name);
        for (const spec of n.specifiers || []) {
          const exportedName = String(spec.exported?.name ?? spec.exported?.value ?? 'default');
          exports.add(exportedName);
          if (exportedName === 'default') defaultExportNames.add(String(spec.local?.name ?? spec.local?.value ?? ''));
        }
      },
      ExportDefaultDeclaration(path) {
        exports.add('default');
        const decl = path.node.declaration;
        if (decl?.id?.name) { exports.add(decl.id.name); defaultExportNames.add(decl.id.name); }
      },
      ExportAllDeclaration(path) { recordImport(path.node.source.value, 'reexport', ['*'], path.node.loc?.start.line); exports.add('*'); },
      FunctionDeclaration(path) { addFunction(path, 'declaration'); },
      ArrowFunctionExpression(path) { if (isFunctionValue(path)) addFunction(path, 'arrow'); },
      FunctionExpression(path) { if (isFunctionValue(path)) addFunction(path, 'expression'); },
      ClassMethod(path) { addFunction(path, 'method'); },
      ObjectMethod(path) { addFunction(path, 'method'); }
    });

    function isFunctionValue(path) {
      const parent = path.parentPath;
      return parent?.isVariableDeclarator() || parent?.isAssignmentExpression() || parent?.isObjectProperty() || parent?.isClassProperty();
    }
    function addFunction(path, kind) {
      const node = path.node;
      const name = nodeName(node, `${kind}_${++serial}`, path.parentPath?.node);
      const startLine = node.loc?.start.line || 1;
      const endLine = node.loc?.end.line || startLine;
      const idFn = `${id}#${name}@${startLine}`;
      functionMap.set(node, idFn);
      const parent = path.parentPath;
      const assignedAsDefault = parent?.isAssignmentExpression?.() && isModuleExportsTarget(parent.node.left);
      const isDefaultExport = Boolean(parent?.isExportDefaultDeclaration?.() || assignedAsDefault);
      const info = { id: idFn, file: id, name, kind, startLine, endLine, complexity: computeComplexity(path), exported: isDefaultExport, defaultExport: isDefaultExport, calls: [], unresolvedCalls: 0 };
      functions.push(info);
    }

    const functionIdForNode = (node) => functionMap.get(node) || null;
    const localFunctionForBinding = (binding) => {
      if (!binding?.path) return null;
      if (binding.path.isFunctionDeclaration?.()) return functionIdForNode(binding.path.node);
      if (binding.path.isVariableDeclarator?.()) {
        const init = binding.path.node.init;
        return functionIdForNode(init);
      }
      return null;
    };

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        let current = path.findParent(p => p.isFunction());
        let fromFnId = current ? functionIdForNode(current.node) : null;
        if (!fromFnId) fromFnId = `${id}#<module>@1`;
        let calleeName = '';
        let viaImport;
        let sameFileTarget;
        if (callee.type === 'Identifier') {
          calleeName = callee.name;
          const binding = path.scope.getBinding(callee.name);
          viaImport = getImportBinding(binding);
          sameFileTarget = localFunctionForBinding(binding);
          if (callee.name === 'require' && path.node.arguments[0]?.type === 'StringLiteral') {
            recordImport(path.node.arguments[0].value, 'require', ['default'], path.node.loc?.start.line);
          }
        } else if (callee.type === 'MemberExpression' && callee.object?.type === 'Identifier') {
          const objectName = callee.object.name;
          calleeName = callee.computed ? String(callee.property?.value ?? '') : String(callee.property?.name ?? '');
          const binding = path.scope.getBinding(objectName);
          const imported = getImportBinding(binding);
          if (imported && (imported.namespace || imported.importedName === 'default')) viaImport = { ...imported, importedName: calleeName };
        } else if (callee.type === 'Import' && path.node.arguments[0]?.type === 'StringLiteral') {
          recordImport(path.node.arguments[0].value, 'dynamic', ['default'], path.node.loc?.start.line);
        }
        if ((calleeName && calleeName !== 'require') || viaImport) rawCalls.push({ fromFnId, calleeName: calleeName || viaImport?.importedName || 'dynamic', viaImport, sameFileTarget, line: path.node.loc?.start.line || 1 });
      },
      AssignmentExpression(path) {
        const { left, right } = path.node;
        if (isModuleExportsTarget(left)) {
          exports.add('default');
          // CommonJS commonly exports an object of named functions or bindings.
          if (right?.type === 'ObjectExpression') {
            for (const property of right.properties) {
              if (property.type === 'SpreadElement') continue;
              const key = property.computed ? (property.key?.value != null ? String(property.key.value) : null) : (property.key?.name ?? property.key?.value);
              if (key) exports.add(String(key));
            }
          } else if (right?.type === 'Identifier') { exports.add(right.name); defaultExportNames.add(right.name); }
        }
        if (left?.type === 'MemberExpression' && left.object?.name === 'exports') {
          const key = memberPropertyName(left);
          if (key) exports.add(key);
        }
        if (left?.type === 'MemberExpression' && isModuleExportsTarget(left.object)) {
          const key = memberPropertyName(left);
          if (key) exports.add(key);
        }
      }
    });

    for (const fn of functions) {
      fn.defaultExport = fn.defaultExport || defaultExportNames.has(fn.name);
      fn.exported = fn.defaultExport || exports.has(fn.name) || (fn.name === 'default' && exports.has('default'));
    }
    // Include top-level decisions and count token-like Babel tokens (identifiers/literals/punctuation).
    const fileComplexity = functions.reduce((sum, fn) => sum + fn.complexity, 0) + topLevelComplexity(ast);
    return {
      id, loc, tokens: ast.tokens?.length || 0, contentHash, sizeBytes, imports, exports: [...exports],
      functions, rawCalls, fileComplexity, parseError: ast.errors?.length ? ast.errors.map(e => e.message).slice(0, 3).join('; ') : undefined
    };
  } catch (error) {
    return {
      id, loc, tokens: 0, contentHash, sizeBytes, imports: [], exports: [], functions: [], rawCalls: [],
      fileComplexity: 1, parseError: error.message || 'Unsupported syntax'
    };
  }
}
