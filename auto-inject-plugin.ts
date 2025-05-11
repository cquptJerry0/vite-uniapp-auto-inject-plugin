import { Plugin, ResolvedConfig } from 'vite'
import * as fs from 'fs'
import * as path from 'path'

// 插入位置枚举
export enum InsertPosition {
  BEFORE_CONTENT = 'before-content',
  AFTER_CONTENT = 'after-content',
  ROOT_END = 'root-end',
}

// 插件参数接口
export interface AutoInjectOptions {
  // 组件文件路径（必填）
  componentPath: string
  // 组件名称（默认取文件名）
  componentName?: string
  // 注册在页面中的名称
  registerName?: string
  // 组件在template中插入的位置
  insertPosition?: InsertPosition
  // 排除某些页面路径
  exclude?: string[]
  // 只在特定页面注入
  include?: string[]
  // 组件传入的props, value是string则是透传attribute, 否则是v-bind
  props?: Record<string, any>
  // 是否添加ref属性
  withRef?: boolean
  // ref的名称
  refName?: string
  // 自定义组件标签内容
  customTemplate?: string
}

export function AutoInjectPlugin(options: AutoInjectOptions): Plugin {
  // 处理默认值
  const {
    componentPath,
    componentName = getComponentNameFromPath(componentPath),
    registerName = componentName,
    insertPosition = InsertPosition.ROOT_END,
    exclude = [],
    include = [],
    props = {},
    withRef = true,
    refName = componentName,
    customTemplate = null,
  } = options

  // 存储插件状态
  let config: ResolvedConfig
  let pagesPaths: string[] = []
  let processedPaths: string[] = []

  return {
    name: 'vite-plugin-uniapp-auto-inject',
    enforce: 'pre',
    configResolved(resolvedConfig: ResolvedConfig) {
      config = resolvedConfig

      try {
        // 读取pages.json
        const pagesJsonPath = path.resolve(
          process.cwd(),
          'src/pages.json',
        )
        if (fs.existsSync(pagesJsonPath)) {
          const pagesContent = fs.readFileSync(pagesJsonPath, 'utf-8')
          const pagesJson = JSON.parse(pagesContent)

          // 提取页面路径
          pagesPaths = extractPagePaths(pagesJson)
          console.log(`从pages.json中提取的页面路径: ${pagesPaths}`)
          // 应用include/exclude过滤
          processedPaths = pagesPaths.filter((pagePath) => {
            // 如果设置了include，只处理include中的路径
            if (include.length > 0) {
              return include.some((includePath) =>
                pagePath.includes(includePath),
              )
            }

            // 排除exclude中的路径
            if (exclude.length > 0) {
              return !exclude.some((excludePath) =>
                pagePath.includes(excludePath),
              )
            }

            return true
          })
          console.log(
            `[auto-inject] Found ${pagesPaths.length} pages, ${processedPaths.length} will be processed`,
          )
        } else {
          console.warn(
            '[auto-inject] pages.json not found at',
            pagesJsonPath,
          )
        }
      } catch (error) {
        console.error(
          '[auto-inject] Error reading pages.json:',
          error,
        )
      }

      // 验证组件路径是否存在
      validateComponentPath(componentPath, config)
    },

    transform(code: string, id: string) {
      // 只处理Vue文件
      if (!id.endsWith('.vue')) {
        return null
      }

      // 判断是否为需要处理的页面文件
      if (!isPageFile(id, processedPaths)) {
        return null
      }

      // 检查是否已包含组件
      if (hasComponent(code, registerName)) {
        return null
      }

      // 开始注入组件
      try {
        // 创建组件标签
        const componentTag = createComponentTag(
          registerName,
          withRef,
          refName,
          props,
          customTemplate,
        )

        // 注入组件标签到模板
        let result = injectComponentToTemplate(
          code,
          componentTag,
          insertPosition,
        )

        // 注入组件导入和注册
        result = injectComponentImport(
          result,
          componentName,
          componentPath,
        )

        result = registerComponentInScript(
          result,
          componentName,
          registerName,
        )
        // 打印处理后的文件内容
        console.log('===== 处理后文件内容 =====')
        console.log(result)
        console.log('===== 处理后文件内容结束 =====')
        return result
      } catch (error) {
        console.error(
          `[auto-inject] Error injecting component into ${id}:`,
          error,
        )
        return null
      }
    },
  }
}

// 辅助函数
// 从路径中提取组件名
function getComponentNameFromPath(componentPath: string): string {
  const fileName = path.basename(
    componentPath,
    path.extname(componentPath),
  )
  return fileName.charAt(0).toLowerCase() + fileName.slice(1)
}

// 验证组件路径
function validateComponentPath(
  componentPath: string,
  config: ResolvedConfig,
): void {
  // 基本检查
  if (!componentPath) {
    throw new Error('[auto-inject] componentPath is required')
  }

  try {
    // 处理别名路径
    let resolvedPath = componentPath

    // 检查路径是否使用了任何配置的别名
    const alias = config.resolve.alias

    if (alias) {
      // 处理数组形式的别名配置
      if (Array.isArray(alias)) {
        for (const entry of alias) {
          const aliasFind = entry.find
          if (
            typeof aliasFind === 'string' &&
            componentPath.startsWith(aliasFind + '/')
          ) {
            resolvedPath = componentPath.replace(
              new RegExp(`^${aliasFind}/`),
              `${entry.replacement}/`,
            )
            break
          }
        }
      }
      // 处理对象形式的别名配置
      else {
        const aliasEntries = Object.entries(alias)
        for (const [key, value] of aliasEntries) {
          // 确保别名以/结尾匹配整个路径段
          const aliasKey = key.endsWith('/') ? key : `${key}/`
          if (componentPath.startsWith(aliasKey)) {
            const replacement =
              typeof value === 'string'
                ? value
                : (value as any).replacement || value
            resolvedPath = componentPath.replace(
              new RegExp(`^${aliasKey}`),
              replacement.endsWith('/')
                ? replacement
                : `${replacement}/`,
            )
            break
          }
        }
      }
    }

    // 确保路径是绝对路径
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(process.cwd(), resolvedPath)
    }

    // 处理不同的扩展名情况
    let filePath = resolvedPath
    if (!path.extname(resolvedPath)) {
      filePath = `${resolvedPath}.vue`
    } else if (!resolvedPath.endsWith('.vue')) {
      throw new Error('[auto-inject] Component must be a .vue file')
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `[auto-inject] Component file not found: ${filePath}`,
      )
    }

    // 验证文件内容（可选，检查是否是有效的Vue组件）
    const content = fs.readFileSync(filePath, 'utf-8')
    if (!content.includes('<template>')) {
      throw new Error(
        `[auto-inject] File is not a valid Vue component: ${filePath}`,
      )
    }
  } catch (error) {
    // 捕获并重新抛出更明确的错误
    if (error instanceof Error) {
      throw new Error(`[auto-inject] ${error.message}`)
    } else {
      throw new Error(
        `[auto-inject] Unknown error validating component path: ${componentPath}`,
      )
    }
  }
}

// 从pages.json提取页面路径
function extractPagePaths(pagesJson: any): string[] {
  const paths: string[] = []

  // 处理主包页面
  if (pagesJson.pages && Array.isArray(pagesJson.pages)) {
    pagesJson.pages.forEach((page: any) => {
      if (page.path) {
        paths.push(page.path)
      }
    })
  }

  // 处理分包页面
  if (pagesJson.subPackages && Array.isArray(pagesJson.subPackages)) {
    pagesJson.subPackages.forEach((subPackage: any) => {
      const root = subPackage.root || ''
      if (subPackage.pages && Array.isArray(subPackage.pages)) {
        subPackage.pages.forEach((page: any) => {
          if (page.path) {
            paths.push(`${root}/${page.path}`)
          }
        })
      }
    })
  }

  return paths
}

// 判断是否为页面文件
function isPageFile(id: string, processedPaths: string[]): boolean {
  // 标准化路径
  const normalizedId = id.replace(/\\/g, '/')

  // 检查是否匹配任一处理路径
  return processedPaths.some((pagePath) => {
    // 支持多种匹配模式
    return (
      normalizedId.includes(`/pages/${pagePath}.vue`) ||
      normalizedId.includes(`/${pagePath}.vue`) ||
      normalizedId.endsWith(`/${pagePath}.vue`)
    )
  })
}

// 检查是否已包含组件
function hasComponent(code: string, componentName: string): boolean {
  const lowerCaseName = componentName.toLowerCase()
  return (
    code.includes(`<${componentName}`) ||
    code.includes(`<${lowerCaseName}`) ||
    code.includes(`:is="${componentName}"`) ||
    code.includes(`:is="${lowerCaseName}"`)
  )
}

// 创建组件标签
function createComponentTag(
  registerName: string,
  withRef: boolean,
  refName: string,
  props: Record<string, any>,
  customTemplate: string | null,
): string {
  // 使用自定义模板
  if (customTemplate) {
    return customTemplate
  }

  // 构造props字符串
  const propsString = Object.entries(props)
    .map(([key, value]) => {
      // 处理不同类型的值
      if (typeof value === 'string') {
        return `${key}="${value}"`
      } else {
        return `:${key}="${JSON.stringify(value)}"`
      }
    })
    .join(' ')

  // 构造ref属性
  const refAttr = withRef ? `ref="${refName}"` : ''

  // 返回完整的组件标签
  return `<${registerName} ${refAttr} ${propsString}></${registerName}>`
}

// 将组件标签注入到模板
function injectComponentToTemplate(
  code: string,
  componentTag: string,
  insertPosition: InsertPosition,
): string {
  // 如果没有template标签，不处理
  if (!code.includes('<template>')) {
    return code
  }

  switch (insertPosition) {
    case InsertPosition.BEFORE_CONTENT:
      // 在内容前插入
      return code.replace(
        /<template>\s*/,
        `<template>\n  ${componentTag}\n  `,
      )

    case InsertPosition.AFTER_CONTENT:
      // 查找第一个闭合的根标签
      const match =
        /<template>\s*([\s\S]*?)(<\/[a-zA-Z0-9_-]+>)(?=\s*<\/template>)/
      const result = match.exec(code)
      if (result && result[2]) {
        return code.replace(
          result[2],
          `${result[2]}\n  ${componentTag}`,
        )
      }
      // 如果找不到，就放在template结束前
      return code.replace(
        /<\/template>/,
        `  ${componentTag}\n</template>`,
      )

    case InsertPosition.ROOT_END:
    default:
      // 在template结束前插入
      return code.replace(
        /<\/template>/,
        `  ${componentTag}\n</template>`,
      )
  }
}

// 检测Vue文件的script类型和位置: 主要是作为inject和register的工具函数
function detectScriptInfo(code: string): {
  isSetup: boolean
  isTypeScript: boolean
  hasScript: boolean
  scriptPattern: RegExp
  hasExportDefault: boolean
  scriptEndIndex: number
} {
  // 检测是否有script标签
  const hasScript = code.includes('<script')

  // 检测是否使用setup语法 - 这里需要更精确的匹配
  const scriptTagMatch = hasScript
    ? code.match(/<script([^>]*)>/)
    : null
  let isSetup = false

  if (scriptTagMatch && scriptTagMatch[1]) {
    const tagAttributes = scriptTagMatch[1]
    isSetup = tagAttributes.includes('setup')
  }

  // 检测是否使用TypeScript
  const isTypeScript =
    code.includes('lang="ts"') || code.includes("lang='ts'")

  // 构建script标签正则
  let scriptPattern: RegExp
  if (isSetup) {
    // 更精确匹配setup语法的script标签
    scriptPattern = /<script[^>]*setup[^>]*>/
  } else {
    scriptPattern = /<script[^>]*>/
  }

  // 检测是否已有export default
  const hasExportDefault =
    code.includes('export default') ||
    code.includes('defineComponent(')

  // 找到script结束位置
  const scriptEndIndex = code.lastIndexOf('</script>')

  return {
    isSetup,
    isTypeScript,
    hasScript,
    scriptPattern,
    hasExportDefault,
    scriptEndIndex,
  }
}

// 注入组件导入
function injectComponentImport(
  code: string,
  componentName: string,
  componentPath: string,
): string {
  // 检查是否已导入
  const alreadyImported =
    code.includes(`import ${componentName} from`) ||
    code.includes(`import { ${componentName} } from`)

  if (alreadyImported) {
    return code
  }

  const importStatement = `import ${componentName} from '${componentPath}';\n`

  // 获取脚本信息
  const { isSetup, isTypeScript, hasScript, scriptPattern } =
    detectScriptInfo(code)

  if (hasScript) {
    // 找到script标签并插入导入语句
    const scriptTagMatch = code.match(scriptPattern)
    if (scriptTagMatch) {
    }
    return code.replace(
      scriptPattern,
      (match) => `${match}\n${importStatement}`,
    )
  } else {
    // 如果没有script标签，添加一个新的
    let newScript = ''

    if (isTypeScript) {
      newScript = isSetup
        ? `<script setup lang="ts">\n${importStatement}</script>\n`
        : `<script lang="ts">\n${importStatement}\nexport default {}\n</script>\n`
    } else {
      newScript = isSetup
        ? `<script setup>\n${importStatement}</script>\n`
        : `<script>\n${importStatement}\nexport default {}\n</script>\n`
    }
    return `${newScript}${code}`
  }
}

// 在组件选项中注册组件
function registerComponentInScript(
  code: string,
  componentName: string,
  registerName: string,
): string {
  // 获取脚本信息
  const {
    isSetup,
    isTypeScript,
    hasScript,
    hasExportDefault,
    scriptEndIndex,
  } = detectScriptInfo(code)

  // 如果是setup语法，不需要在components选项中注册，直接返回原代码
  if (isSetup) {
    // 检查</script>前是否有多余的逗号和花括号
    if (scriptEndIndex !== -1) {
      // 检查script结束标签前的内容
      const scriptContent = code.substring(0, scriptEndIndex)
      // 提取最后20个字符用于日志
      const lastChars = scriptContent.slice(-20)

      // 查找最后一个非空白字符
      const lastContentMatch = scriptContent.match(/([^\s])(\s*)$/)

      if (lastContentMatch) {
        const lastChar = lastContentMatch[1]

        // 如果最后一个字符是逗号或花括号，可能是问题所在
        if (lastChar === ',' || lastChar === '}') {
          // 检查是否有多余的花括号+逗号模式 },}
          const problemPatterns = [
            /},\s*}(\s*)$/, // },}
            /,\s*}(\s*)$/, // ,}
            /}\s*,(\s*)$/, // },
          ]

          for (const pattern of problemPatterns) {
            if (pattern.test(scriptContent)) {
              // 根据不同模式进行修复
              let fixedContent
              if (pattern === problemPatterns[0]) {
                // 修复 },} 为 }}
                fixedContent = scriptContent.replace(pattern, '}}')
              } else if (pattern === problemPatterns[1]) {
                // 修复 ,} 为 }
                fixedContent = scriptContent.replace(pattern, '}')
              } else if (pattern === problemPatterns[2]) {
                // 修复 }, 为 }
                fixedContent = scriptContent.replace(pattern, '}')
              }

              return fixedContent + code.substring(scriptEndIndex)
            }
          }

          // 特殊检查多余括号的情况
          const bracketCount = (scriptContent.match(/\{/g) || [])
            .length
          const closeBracketCount = (scriptContent.match(/\}/g) || [])
            .length

          if (closeBracketCount > bracketCount) {
            // 有多余的闭合括号，尝试删除最后一个
            if (lastChar === '}') {
              const fixedContent = scriptContent.replace(
                /\}(\s*)$/,
                '',
              )
              return fixedContent + code.substring(scriptEndIndex)
            }
          }
        }
      }
    }
    return code
  }

  // 以下是非setup语法的处理...
  // 如果有export default
  if (hasExportDefault) {
    // 处理各种导出格式
    if (
      code.includes('export default {') ||
      code.includes('export default defineComponent({')
    ) {
      // 统一匹配各种导出形式
      const exportPattern =
        /(export default\s+(?:defineComponent\s*\()?\s*{)/

      // 检查是否已有components选项
      if (
        code.includes('components:') ||
        code.includes('components :')
      ) {
        // 已有components，添加新组件
        // 首先检查整个components对象的格式
        const fullComponentsRegex = /components\s*:\s*{([^}]*)}/g
        const fullComponentsMatch = [
          ...code.matchAll(fullComponentsRegex),
        ]

        if (
          fullComponentsMatch.length > 0 &&
          !fullComponentsMatch[0][1].includes(componentName)
        ) {
          // 获取组件对象的内容
          const componentsContent = fullComponentsMatch[0][1].trim()
          // 检查最后一个字符是否已经有逗号，且不是空对象
          const needsComma =
            componentsContent !== '' &&
            !componentsContent.endsWith(',')

          // 替换整个组件对象，确保格式正确
          return code.replace(
            /components\s*:\s*{([^}]*)}/,
            `components: {${componentsContent}${
              needsComma ? ',' : ''
            } ${registerName}: ${componentName}}`,
          )
        }
      } else {
        // 没有components，添加新选项 - 确保不添加多余的逗号
        const result = code.replace(
          exportPattern,
          `$1\n  components: {\n    ${registerName}: ${componentName}\n  }`,
        )
        return result
      }
    }
  } else if (scriptEndIndex !== -1) {
    // 没有export default但有script标签，添加一个导出对象
    const exportCode = isTypeScript
      ? `\nexport default defineComponent({\n  components: {\n    ${registerName}: ${componentName}\n  }\n})\n`
      : `\nexport default {\n  components: {\n    ${registerName}: ${componentName}\n  }\n}\n`

    return (
      code.slice(0, scriptEndIndex) +
      exportCode +
      code.slice(scriptEndIndex)
    )
  }

  return code
}
