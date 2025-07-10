# Pick Runner Action

## 项目介绍

这是一个GitHub Action，用于智能选择self-hosted和GitHub-hosted
runners。它会根据self-hosted runners的可用性和GitHub-hosted
runners的剩余用量来做出最优选择。

## 功能特性

- **优先使用self-hosted runners** - 当self-hosted runners空闲时优先使用
- **智能回退机制** - 当self-hosted runners忙碌时，检查GitHub-hosted
  runners的剩余用量
- **用量阈值控制** - 可设置GitHub-hosted runners的最小剩余分钟数阈值
- **JSON输出格式** - 输出统一为JSON格式，支持单个和多个标签
- **支持个人和组织仓库** - 自动检测并使用相应的API端点

## 输入参数

| 参数                  | 必需 | 默认值 | 说明                                                         |
| --------------------- | ---- | ------ | ------------------------------------------------------------ |
| `self-hosted-tags`    | 是   | -      | self-hosted runners的标签（逗号分隔），如"linux,self-hosted" |
| `github-hosted-tags`  | 是   | -      | GitHub-hosted runners的标签（逗号分隔），如"ubuntu-latest"   |
| `github-hosted-limit` | 是   | 1000   | GitHub-hosted runners的最小剩余分钟数阈值                    |
| `github-token`        | 是   | -      | 具有组织admin权限的GitHub token                              |

## 输出参数

| 参数              | 说明                                         |
| ----------------- | -------------------------------------------- |
| `selected-runner` | 选中的runner标签（JSON格式）                 |
| `runner-type`     | runner类型（"self-hosted"或"github-hosted"） |
| `reason`          | 选择的原因说明                               |

## 使用示例

```yaml
- name: Pick Runner
  id: pick-runner
  uses: ./
  with:
    self-hosted-tags: "linux,self-hosted"
    github-hosted-tags: "ubuntu-latest"
    github-hosted-limit: 1000
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Run job
  runs-on: ${{ fromJSON(steps.pick-runner.outputs.selected-runner) }}
  steps:
    - run: echo "Running on ${{ steps.pick-runner.outputs.runner-type }}"
    - run: echo "Reason: ${{ steps.pick-runner.outputs.reason }}"
```

## 选择逻辑

1. **检查self-hosted runners**
   - 如果有在线且空闲的self-hosted runners，优先选择
2. **检查GitHub-hosted runners用量**
   - 如果self-hosted runners忙碌，检查GitHub-hosted runners的剩余用量
   - 如果剩余用量大于等于设定的阈值，选择GitHub-hosted runners
3. **回退到self-hosted runners**
   - 如果GitHub-hosted runners用量不足，回退到self-hosted runners（即使忙碌）

## 开发命令

```bash
# 安装依赖
npm install

# 格式化代码
npm run format:write

# 运行linting
npm run lint

# 运行测试
npm run test

# 构建package
npm run package

# 完整构建流程
npm run all
```

## API权限要求

### 使用Personal Access Token (Classic)

**对于组织仓库：**

- `admin:org` scope（用于获取组织级self-hosted runners和billing信息）

**对于个人仓库：**

- `repo` scope（用于获取仓库级self-hosted runners信息）
- `user` scope（用于获取用户billing信息）

### 使用Fine-grained Personal Access Token

**对于组织仓库：**

- Organization permissions: "Self-hosted runners" (read)
- Organization permissions: "Administration" (read) for billing

**对于个人仓库：**

- Repository permissions: "Self-hosted runners" (read)
- Account permissions: "Billing" (read)

### 重要提醒

⚠️ **`secrets.GITHUB_TOKEN`权限限制**：

- 默认的`GITHUB_TOKEN`通常没有足够权限访问self-hosted runners和billing信息
- 建议使用具有适当权限的Personal Access Token
- 将token存储为repository secret，例如`secrets.PAT_TOKEN`

## 注意事项

- 仓库所有者和名称通过`GITHUB_REPOSITORY_OWNER`和`GITHUB_REPOSITORY`环境变量自动获取
- 自动检测仓库类型（个人或组织），并使用相应的API端点
- 用量限制的单位是分钟数（minutes）
- 输出的runner标签始终为JSON格式，需要使用`fromJSON`解析
- 个人仓库的self-hosted runners是仓库级别的，组织仓库的self-hosted
  runners是组织级别的
