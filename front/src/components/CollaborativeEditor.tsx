'use client'

import {ChangeEvent, useState} from 'react'
import {useYjs} from '@/hooks/useYjs'

interface CollaborativeEditorProps {
  roomName?: string
}

export default function CollaborativeEditor({roomName = 'default-room'}: CollaborativeEditorProps) {
  const [currentRoomName, setCurrentRoomName] = useState(roomName)
  const [roomInput, setRoomInput] = useState(roomName)

  const {text, updateText, isConnected, connectedUsers, userList, currentUserId} = useYjs(currentRoomName)

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    updateText(e.target.value)
  }

  const handleRoomChange = () => {
    setCurrentRoomName(roomInput)
  }

  return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-semibold text-black mb-2">接続状態</h3>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-sm text-black">
                {isConnected ? '接続済み' : '切断中'}
              </span>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-semibold text-black mb-2">接続ユーザー数</h3>
              <span className="text-black">{connectedUsers}</span>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-semibold text-black mb-2">現在のルーム</h3>
              <span className="text-sm text-black font-mono">{currentRoomName}</span>
            </div>
          </div>

          {userList.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold text-black mb-3">接続中のユーザー</h3>
                <div className="flex flex-wrap gap-2">
                  {userList.map((user) => (
                      <div
                          key={user.id}
                          className={`flex items-center space-x-2 px-3 py-2 rounded-full text-sm ${
                              user.id === currentUserId ? 'bg-blue-100 border-2 border-blue-300' : 'bg-gray-100'
                          }`}
                      >
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{backgroundColor: user.color}}
                        ></div>
                        <span className="text-black">
                    {user.name} {user.id === currentUserId && '(You)'}
                  </span>
                      </div>
                  ))}
                </div>
              </div>
          )}

          <div className="mb-6">
            <div className="flex space-x-2">
              <input
                  type="text"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  placeholder="ルーム名を入力"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                  onClick={handleRoomChange}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                ルーム変更
              </button>
            </div>
          </div>

          <div className="mb-4">
            <h3 className="text-black mb-2">共同編集テキスト</h3>
            <textarea
                value={text}
                onChange={handleTextChange}
                className="text-black w-full h-64 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>
      </div>
  )
}