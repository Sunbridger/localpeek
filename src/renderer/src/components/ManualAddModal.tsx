import { useEffect, useState } from 'react'
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select } from 'antd'
import type { DbKind, InstanceMeta } from '../../../shared/types'
import { api } from '../api'
import { cleanError } from '../utils'

interface ManualAddModalProps {
  open: boolean
  onClose: () => void
  onAdded: (instance: InstanceMeta) => void
}

interface FormValues {
  kind: DbKind
  host: string
  port: number
  username?: string
  password?: string
  label?: string
}

export default function ManualAddModal({ open, onClose, onAdded }: ManualAddModalProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kind = Form.useWatch('kind', form) ?? 'mysql'

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        kind: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        username: 'root',
        password: '',
        label: ''
      })
      setError(null)
    }
  }, [open, form])

  const finish = async (values: FormValues): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      const instance = await api.addManual({
        kind: values.kind,
        host: values.host.trim(),
        port: Number(values.port),
        username: values.kind === 'mysql' ? values.username?.trim() || 'root' : undefined,
        password: values.password ?? '',
        label: values.label?.trim() || undefined
      })
      message.success('连接已添加')
      onAdded(instance)
      onClose()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const test = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      setTesting(true)
      setError(null)
      const result = await api.testConnection({
        kind: values.kind,
        host: values.host.trim(),
        port: Number(values.port),
        username: values.kind === 'mysql' ? values.username?.trim() || 'root' : undefined,
        password: values.password ?? ''
      })
      if (result.ok) {
        message.success(`连接成功${result.version ? ` · ${result.version}` : ''}`)
      } else {
        setError(result.error ?? '连接失败')
      }
    } catch (err) {
      if (err instanceof Error) setError(cleanError(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="添加数据库连接"
      onCancel={onClose}
      width={520}
      footer={[
        <Button key="test" loading={testing} onClick={test}>
          测试连接
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="ok" type="primary" loading={submitting} onClick={() => form.submit()}>
          保存并连接
        </Button>
      ]}
    >
      <Form form={form} layout="vertical" onFinish={finish} style={{ marginTop: 12 }}>
        <Form.Item label="类型" name="kind" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'mysql', label: 'MySQL' },
              { value: 'redis', label: 'Redis' }
            ]}
            onChange={(value: DbKind) => {
              form.setFieldValue('port', value === 'mysql' ? 3306 : 6379)
            }}
          />
        </Form.Item>
        <Form.Item label="主机" name="host" rules={[{ required: true, message: '请填写主机地址' }]}>
          <Input placeholder="127.0.0.1 或局域网 / SSH 转发地址" />
        </Form.Item>
        <Form.Item
          label="端口"
          name="port"
          rules={[{ required: true, message: '请填写端口' }]}
        >
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        {kind === 'mysql' ? (
          <Form.Item label="用户名" name="username">
            <Input placeholder="root" autoComplete="off" />
          </Form.Item>
        ) : null}
        <Form.Item label="密码" name="password">
          <Input.Password
            autoComplete="off"
            placeholder={kind === 'mysql' ? 'MySQL 密码' : 'Redis 密码（无密码可留空）'}
          />
        </Form.Item>
        <Form.Item label="显示名称（可选）" name="label">
          <Input placeholder="例如：本地测试库" />
        </Form.Item>
        {error ? (
          <Alert
            type="error"
            showIcon
            title="连接失败"
            description={<span className="mono">{error}</span>}
          />
        ) : null}
      </Form>
    </Modal>
  )
}
