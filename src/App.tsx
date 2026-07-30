import { ReactFlowProvider } from '@xyflow/react'
import { Board } from './components/Board'

export default function App() {
  return (
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>
  )
}
