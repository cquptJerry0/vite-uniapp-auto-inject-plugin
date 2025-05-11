# Vite UniApp 自动注入组件插件

这是一个针对 UniApp 项目的 Vite 插件，可以自动将指定组件注入到页面中，无需手动在每个页面引入和注册组件。特别适合全局组件、统计组件、埋点组件等需要在多个页面中使用的情况。

## 特性

- 🚀 自动向符合条件的页面注入组件
- 🔍 支持页面路径过滤（包含/排除）
- 💪 自动处理组件导入和注册
- 🛠 灵活的插入位置配置
- ⚙️ 可配置组件属性和 ref

## 基本使用

在 Vite 配置文件中引入并配置插件:

```js
// vite.config.js / vite.config.ts
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { AutoInjectPlugin } from 'vite-plugin-uniapp-auto-inject'

export default defineConfig({
  plugins: [
    uni(),
    AutoInjectPlugin({
      componentPath: '@/components/GlobalTracker.vue',
      insertPosition: 'root-end',
    }),
  ],
})
```

## 配置选项

| 选项             | 类型                  | 默认值                  | 描述                   |
| ---------------- | --------------------- | ----------------------- | ---------------------- |
| `componentPath`  | `string`              | -                       | **必填** 组件文件路径  |
| `componentName`  | `string`              | _从文件名获取_          | 组件名称               |
| `registerName`   | `string`              | _与 componentName 相同_ | 组件在页面中注册的名称 |
| `insertPosition` | `InsertPosition`      | `'root-end'`            | 组件在模板中插入的位置 |
| `exclude`        | `string[]`            | `[]`                    | 排除某些页面路径       |
| `include`        | `string[]`            | `[]`                    | 只在特定页面注入       |
| `props`          | `Record<string, any>` | `{}`                    | 组件传入的 props       |
| `withRef`        | `boolean`             | `true`                  | 是否添加 ref 属性      |
| `refName`        | `string`              | _与 componentName 相同_ | ref 的名称             |
| `customTemplate` | `string`              | `null`                  | 自定义组件标签内容     |

### 插入位置枚举 (`InsertPosition`)

```typescript
enum InsertPosition {
  BEFORE_CONTENT = 'before-content', // 在内容前插入
  AFTER_CONTENT = 'after-content', // 在内容后插入
  ROOT_END = 'root-end', // 在template结束前插入
}
```

## 使用示例

### 添加带属性的组件

```js
AutoInjectPlugin({
  componentPath: '@/components/Analytics.vue',
  componentName: 'Analytics',
  registerName: 'page-analytics',
  props: {
    appId: 'your-app-id',
    enableTracking: true,
    pageType: 'normal',
  },
})
```

### 使用过滤条件

```js
AutoInjectPlugin({
  componentPath: '@/components/AdBanner.vue',
  include: ['home', 'product/detail'], // 只在首页和产品详情页显示
})
```

```js
AutoInjectPlugin({
  componentPath: '@/components/Debugger.vue',
  exclude: ['login', 'payment'], // 在登录页和支付页不显示
})
```

### 自定义模板 指的是组件的标签 这样就不需填 props 了

```js
AutoInjectPlugin({
  componentPath: '@/components/CustomFooter.vue',
  customTemplate:
    '<custom-footer :theme="isDarkMode ? \'dark\' : \'light\'" @click="trackFooterClick" />',
})
```

## 工作原理

1. 插件从 pages.json 中读取页面路径
2. 根据 include 和 exclude 配置过滤页面
3. 当编译 Vue 文件时，检查是否为目标页面
4. 自动向符合条件的页面注入组件引入、注册和使用代码

## 注意事项

- 确保组件路径正确，支持使用别名（如@/）
- 如果使用 TypeScript，请确保组件类型定义正确
- 该插件仅在开发和构建阶段生效，不会影响运行时性能

## 常见问题

### 组件没有被注入?

- 检查页面是否已经包含了该组件（插件会跳过已包含组件的页面）
- 验证页面路径是否与 pages.json 中的配置匹配
- 查看 exclude 和 include 配置是否排除了目标页面

### 编译错误?

如果遇到编译错误，可能是组件注入位置不合适导致模板结构错误，尝试更改`insertPosition`配置。
