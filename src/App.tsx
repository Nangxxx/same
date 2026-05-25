/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, type FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Send, User, Bot, Loader2, Sparkles, GlassWater, 
  Trash2, RotateCcw, Settings, Plus, MessageSquare, 
  ChevronLeft, ChevronRight, Save, X, Edit3,
  Share2, Flag, MoreHorizontal, History,
  Settings2, UserCircle, RefreshCcw, Menu, LogIn, LogOut
} from "lucide-react";
import Markdown from "react-markdown";
import { chatStream, Message, DEFAULT_INITIAL_PROMPT, DEFAULT_SYSTEM_INSTRUCTION } from "./services/gemini";
import { db, auth, signInWithGoogle, logout } from "./lib/firebase";
import { 
  collection, doc, setDoc, getDoc, getDocs, deleteDoc, 
  query, where, orderBy, onSnapshot, serverTimestamp, 
  writeBatch, getDocFromServer 
} from "firebase/firestore";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Midorima Avatar
// @ts-ignore
import midorimaAvatar from "./assets/images/midorima_avatar_1779120547109.png";

interface ChatSession {
  id: string;
  userId?: string;
  title: string;
  messages: Message[];
  systemInstruction: string;
  createdAt: number;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
  currentSessionId: string | null;
}

function ChatInput({ onSend, isLoading, currentSessionId }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!value.trim() || isLoading || !currentSessionId) return;
    onSend(value);
    setValue("");
  };

  return (
    <form 
      onSubmit={handleSubmit}
      className="max-w-3xl mx-auto relative pointer-events-auto"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Gửi tin nhắn cho Midorima Shintaro..."
        className="w-full bg-neutral-100 border-none rounded-2xl py-4 pl-6 pr-14 text-[16px] md:text-[15px] focus:outline-none shadow-sm placeholder:text-neutral-400 transition-all focus:bg-neutral-50 resize-none overflow-y-auto max-h-32"
        rows={1}
        style={{ minHeight: '56px' }}
      />
      <button
        type="submit"
        disabled={isLoading || !value.trim() || !currentSessionId}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-neutral-900 text-white disabled:opacity-30 transition-all"
      >
        <Send size={18} />
      </button>
    </form>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [charAvatar, setCharAvatar] = useState<string>(midorimaAvatar);
  const [userTraits, setUserTraits] = useState("Một sinh viên bình thường, đôi khi hơi nghịch ngợm.");
  const [tempUserTraits, setTempUserTraits] = useState("Một sinh viên bình thường, đôi khi hơi nghịch ngợm.");
  const [charTraits, setCharTraits] = useState("Vô cảm, nghiêm khắc, kỷ luật.");
  const [tempCharTraitsState, setTempCharTraitsState] = useState("Vô cảm, nghiêm khắc, kỷ luật.");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION);
  const [tempInstruction, setTempInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION);
  const [initialPrompt, setInitialPrompt] = useState(DEFAULT_INITIAL_PROMPT);
  const [tempInitialPrompt, setTempInitialPrompt] = useState(DEFAULT_INITIAL_PROMPT);
  const [authError, setAuthError] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingMessageRef = useRef<{ id: string; content: string } | null>(null);

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const messages = currentSession?.messages || [];

  // Firebase Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('permission-denied')) {
          // Expected if not authenticated or no rule for 'test'
          return;
        }
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return () => unsubscribe();
  }, []);

  // Data Fetching
  useEffect(() => {
    if (user) {
      // Sync sessions from Firestore
      const q = query(
        collection(db, "sessions"), 
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );

      const unsubscribeSessions = onSnapshot(q, (snapshot) => {
        const sessionList: ChatSession[] = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            ...data,
            id: doc.id,
            createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt
          } as ChatSession;
        });
        setSessions(sessionList);
        
        if (sessionList.length > 0 && !currentSessionId) {
          setCurrentSessionId(sessionList[0].id);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, "sessions");
      });

      return () => unsubscribeSessions();
    } else {
      // LocalStorage for guests
      const savedSessions = localStorage.getItem("chat_sessions");
      if (savedSessions) {
        const parsed = JSON.parse(savedSessions);
        setSessions(parsed);
        if (parsed.length > 0 && !currentSessionId) {
          setCurrentSessionId(parsed[0].id);
        }
      }
    }
  }, [user]);

  // Sync messages for current session if logged in
  useEffect(() => {
    if (user && currentSessionId) {
      const q = query(
        collection(db, "sessions", currentSessionId, "messages"),
        orderBy("timestamp", "asc")
      );

      const unsubscribeMessages = onSnapshot(q, (snapshot) => {
        const msgList = snapshot.docs.map(doc => {
          const data = doc.data();
          const msgId = doc.id;
          let content = data.content || "";
          let allContents = data.allContents;
          let activeIndex = data.activeIndex;
          
          if (streamingMessageRef.current && streamingMessageRef.current.id === msgId) {
            content = streamingMessageRef.current.content;
            if (allContents && activeIndex !== undefined && activeIndex < allContents.length) {
              allContents = [...allContents];
              allContents[activeIndex] = content;
            }
          }

          return {
            ...data,
            id: msgId,
            content,
            allContents,
            activeIndex,
            timestamp: data.timestamp?.toMillis ? data.timestamp.toMillis() : data.timestamp
          } as Message;
        });
        setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: msgList } : s));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `sessions/${currentSessionId}/messages`);
      });

      return () => unsubscribeMessages();
    }
  }, [user, currentSessionId]);

  useEffect(() => {
    if (!user) {
      localStorage.setItem("chat_sessions", JSON.stringify(sessions));
    }
  }, [sessions, user]);

  useEffect(() => {
    const savedInstruction = localStorage.getItem("system_instruction");
    if (savedInstruction) {
      if (!savedInstruction.includes("BILINGUAL") && !savedInstruction.includes("SONG NGỮ")) {
        setSystemInstruction(DEFAULT_SYSTEM_INSTRUCTION);
        setTempInstruction(DEFAULT_SYSTEM_INSTRUCTION);
        localStorage.setItem("system_instruction", DEFAULT_SYSTEM_INSTRUCTION);
      } else {
        setSystemInstruction(savedInstruction);
        setTempInstruction(savedInstruction);
      }
    }
    const savedPrompt = localStorage.getItem("initial_prompt");
    if (savedPrompt) {
      setInitialPrompt(savedPrompt);
      setTempInitialPrompt(savedPrompt);
    }
    const savedTraits = localStorage.getItem("user_traits");
    if (savedTraits) {
      setUserTraits(savedTraits);
      setTempUserTraits(savedTraits);
    }
    const savedCharTraits = localStorage.getItem("char_traits");
    if (savedCharTraits) {
      setCharTraits(savedCharTraits);
      setTempCharTraitsState(savedCharTraits);
    }
    const savedAvatar = localStorage.getItem("user_avatar");
    if (savedAvatar) {
      setUserAvatar(savedAvatar);
    }
    const savedCharAvatar = localStorage.getItem("char_avatar");
    if (savedCharAvatar) {
      setCharAvatar(savedCharAvatar);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("user_traits", userTraits);
  }, [userTraits]);

  useEffect(() => {
    localStorage.setItem("char_traits", charTraits);
  }, [charTraits]);

  useEffect(() => {
    if (userAvatar) localStorage.setItem("user_avatar", userAvatar);
  }, [userAvatar]);

  useEffect(() => {
    localStorage.setItem("char_avatar", charAvatar);
  }, [charAvatar]);

  useEffect(() => {
    localStorage.setItem("system_instruction", systemInstruction);
  }, [systemInstruction]);

  useEffect(() => {
    localStorage.setItem("initial_prompt", initialPrompt);
  }, [initialPrompt]);

  const saveUserConfigInFirestore = async (updatedConfig: {
    systemInstruction?: string;
    initialPrompt?: string;
    userTraits?: string;
    charTraits?: string;
    userAvatar?: string | null;
    charAvatar?: string;
  }) => {
    if (!auth.currentUser) return;
    try {
      const configRef = doc(db, "userConfigs", auth.currentUser.uid);
      await setDoc(configRef, updatedConfig, { merge: true });
    } catch (e) {
      console.error("Lỗi đồng bộ cấu hình Firestore:", e);
    }
  };

  // Sync cloud configs during login / state changes
  useEffect(() => {
    const fetchUserConfig = async () => {
      if (user) {
        try {
          const configRef = doc(db, "userConfigs", user.uid);
          const configSnap = await getDoc(configRef);
          if (configSnap.exists()) {
            const data = configSnap.data();
            if (data.systemInstruction !== undefined) {
              setSystemInstruction(data.systemInstruction);
              setTempInstruction(data.systemInstruction);
            }
            if (data.initialPrompt !== undefined) {
              setInitialPrompt(data.initialPrompt);
              setTempInitialPrompt(data.initialPrompt);
            }
            if (data.userTraits !== undefined) {
              setUserTraits(data.userTraits);
              setTempUserTraits(data.userTraits);
            }
            if (data.charTraits !== undefined) {
              setCharTraits(data.charTraits);
              setTempCharTraitsState(data.charTraits);
            }
            if (data.userAvatar !== undefined) {
              setUserAvatar(data.userAvatar);
            }
            if (data.charAvatar !== undefined) {
              setCharAvatar(data.charAvatar);
            }
          } else {
            // First login: seed current locally set settings
            await setDoc(configRef, {
              systemInstruction,
              initialPrompt,
              userTraits,
              charTraits,
              userAvatar,
              charAvatar
            });
          }
        } catch (error) {
          console.error("Lỗi khi tải cấu hình người dùng từ Firestore:", error);
        }
      }
    };
    fetchUserConfig();
  }, [user]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const saveMessageToFirestore = async (sessionId: string, message: Message) => {
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, "sessions", sessionId, "messages", message.id), {
        ...message,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `sessions/${sessionId}/messages/${message.id}`);
    }
  };

  const createNewChat = async () => {
    const id = Date.now().toString();
    const newSession: ChatSession = {
      id,
      userId: user?.uid,
      title: "Cuộc trò chuyện mới",
      messages: [],
      systemInstruction: systemInstruction,
      createdAt: Date.now()
    };

    if (user) {
      try {
        await setDoc(doc(db, "sessions", id), {
          ...newSession,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `sessions/${id}`);
      }
    } else {
      setSessions(prev => [newSession, ...prev]);
    }
    setCurrentSessionId(id);
    handleInitialResponse(id);
  };

  const handleInitialResponse = async (sessionId: string) => {
    setIsLoading(true);
    
    const initialAIMsgId = "init-ai-" + sessionId;
    const initialAIMsg: Message = { 
      id: initialAIMsgId, 
      role: "model", 
      content: initialPrompt,
      sessionId,
      timestamp: Date.now()
    };

    if (user) {
      await saveMessageToFirestore(sessionId, initialAIMsg);
    } else {
      updateSessionMessages(sessionId, [initialAIMsg]);
    }
    setIsLoading(false);
  };

  const updateSessionMessages = async (sessionId: string, newMessages: Message[]) => {
    if (!user) {
      setSessions(prev => prev.map(s => {
        if (s.id === sessionId) {
          return { ...s, messages: newMessages };
        }
        return s;
      }));
    }
  };

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading || !currentSessionId) return;

    const userMsgId = Date.now().toString();
    const userMsg: Message = { 
      id: userMsgId, 
      role: "user", 
      content: text,
      sessionId: currentSessionId,
      timestamp: Date.now() 
    };
    
    const aiMsgId = (Date.now() + 1).toString();
    const aiMsg: Message = { 
      id: aiMsgId, 
      role: "model", 
      content: "",
      sessionId: currentSessionId,
      timestamp: Date.now() + 1
    };

    if (user) {
      await saveMessageToFirestore(currentSessionId, userMsg);
      await saveMessageToFirestore(currentSessionId, aiMsg);
    } else {
      const updatedMsgs = [...messages, userMsg, aiMsg];
      updateSessionMessages(currentSessionId, updatedMsgs);
    }

    setIsLoading(true);
    streamingMessageRef.current = { id: aiMsgId, content: "" };

    try {
      let accumulated = "";
      const currentMessages = [...messages];
      const apiMessages = [...currentMessages, userMsg];
      
      const personalizedInstruction = `ĐẶC ĐIỂM NHÂN VẬT (Midorima):\n${charTraits}\n\n${systemInstruction}\n\nTHÔNG TIN VỀ {{user}} (Người đang trò chuyện với bạn):\n${userTraits}`;

      await chatStream(apiMessages, async (chunk) => {
        accumulated += chunk;
        if (streamingMessageRef.current && streamingMessageRef.current.id === aiMsgId) {
          streamingMessageRef.current.content = accumulated;
        }
        if (user) {
          setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
              const msgs = [...s.messages];
              const last = msgs.find(m => m.id === aiMsgId);
              if (last) last.content = accumulated;
              return { ...s, messages: msgs };
            }
            return s;
          }));
        } else {
          const currentMsgs = [...messages, userMsg, { ...aiMsg, content: accumulated }];
          updateSessionMessages(currentSessionId, currentMsgs);
        }
      }, personalizedInstruction);

      if (user) {
        await saveMessageToFirestore(currentSessionId, { ...aiMsg, content: accumulated });
      }

    } catch (error: any) {
      console.error("Chat error:", error);
      let errorMsg = "Đã có lỗi xảy ra. Vui lòng thử lại.";
      if (error?.message?.includes("quota") || error?.message?.includes("429")) {
        errorMsg = "Hết lượt sử dụng (Quota exceeded). Vui lòng thử lại sau giây lát hoặc ngày mai.";
      }
      
      if (user) {
        await saveMessageToFirestore(currentSessionId, { ...aiMsg, content: "⚠️ " + errorMsg });
      } else {
        updateSessionMessages(currentSessionId, [...messages, userMsg, { ...aiMsg, content: "⚠️ " + errorMsg }]);
      }
    } finally {
      streamingMessageRef.current = null;
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleNewChatFromHere = async (msgId: string) => {
    if (!currentSessionId) return;
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    
    const newMsgs = messages.slice(0, idx + 1);
    const id = Date.now().toString();
    const newSession: ChatSession = {
      id,
      userId: user?.uid,
      title: "Tiếp nối từ " + (messages[idx].content.slice(0, 15) || "đây") + "...",
      messages: user ? [] : newMsgs,
      systemInstruction: currentSession?.systemInstruction || systemInstruction,
      createdAt: Date.now()
    };

    if (user) {
      try {
        await setDoc(doc(db, "sessions", id), { ...newSession, createdAt: serverTimestamp() });
        const batch = writeBatch(db);
        newMsgs.forEach(m => {
          const mRef = doc(db, "sessions", id, "messages", m.id);
          batch.set(mRef, { ...m, sessionId: id, timestamp: serverTimestamp() });
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `sessions/${id}`);
      }
    } else {
      setSessions(prev => [newSession, ...prev]);
    }

    setCurrentSessionId(id);
    setIsSidebarOpen(true);
  };

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setActiveMenuId(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  const deleteMessage = async (id: string) => {
    if (!currentSessionId) return;
    if (user) {
      try {
        await deleteDoc(doc(db, "sessions", currentSessionId, "messages", id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `sessions/${currentSessionId}/messages/${id}`);
      }
    } else {
      const newMsgs = messages.filter(m => m.id !== id);
      updateSessionMessages(currentSessionId, newMsgs);
    }
  };

  const rewindToMessage = async (id: string) => {
    if (!currentSessionId) return;
    const idx = messages.findIndex(m => m.id === id);
    if (idx === -1) return;
    
    if (user) {
      try {
        const toDelete = messages.slice(idx + 1);
        const batch = writeBatch(db);
        toDelete.forEach(m => {
          batch.delete(doc(db, "sessions", currentSessionId, "messages", m.id));
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `sessions/${currentSessionId}/messages/...`);
      }
    } else {
      updateSessionMessages(currentSessionId, messages.slice(0, idx + 1));
    }
  };

  const handleContinue = async () => {
    if (isLoading || !currentSessionId) return;

    const aiMsgId = Date.now().toString();
    const aiMsg: Message = { 
      id: aiMsgId, 
      role: "model", 
      content: "",
      sessionId: currentSessionId,
      timestamp: Date.now()
    };

    if (user) {
      await saveMessageToFirestore(currentSessionId, aiMsg);
    } else {
      updateSessionMessages(currentSessionId, [...messages, aiMsg]);
    }
    setIsLoading(true);
    streamingMessageRef.current = { id: aiMsgId, content: "" };

    try {
      let accumulated = "";
      const apiMessages: Message[] = [
        ...messages,
        {
          id: "continue-" + Date.now(),
          role: "user" as const,
          content: "(Tiếp tục câu chuyện của bạn...)",
          timestamp: Date.now()
        }
      ];

      const personalizedInstruction = `ĐẶC ĐIỂM NHÂN VẬT (Midorima):\n${charTraits}\n\n${systemInstruction}\n\nTHÔNG TIN VỀ {{user}} (Người đang trò chuyện với bạn):\n${userTraits}`;

      await chatStream(apiMessages, async (chunk) => {
        accumulated += chunk;
        if (streamingMessageRef.current && streamingMessageRef.current.id === aiMsgId) {
          streamingMessageRef.current.content = accumulated;
        }
        if (user) {
          setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
              const msgs = [...s.messages];
              const last = msgs.find(m => m.id === aiMsgId);
              if (last) last.content = accumulated;
              return { ...s, messages: msgs };
            }
            return s;
          }));
        } else {
          const updatedMsgs = [...messages, { ...aiMsg, content: accumulated }];
          updateSessionMessages(currentSessionId, updatedMsgs);
        }
      }, personalizedInstruction);

      if (user) {
        await saveMessageToFirestore(currentSessionId, { ...aiMsg, content: accumulated });
      }

    } catch (error: any) {
      console.error("Continue error:", error);
      let errorMsg = "⚠️ Hết lượt sử dụng hoặc lỗi xảy ra. Vui lòng thử lại.";
      if (error?.message?.includes("quota") || error?.message?.includes("429")) {
        errorMsg = "⚠️ Hết lượt sử dụng (Quota exceeded).";
      }
      
      if (user) {
        await saveMessageToFirestore(currentSessionId, { ...aiMsg, content: errorMsg });
      } else {
        const updatedMsgs = [...messages, { ...aiMsg, content: errorMsg }];
        updateSessionMessages(currentSessionId, updatedMsgs);
      }
    } finally {
      streamingMessageRef.current = null;
      setIsLoading(false);
    }
  };

  const handleRegenerate = async (msgId?: string) => {
    if (!currentSessionId || messages.length === 0 || isLoading) return;
    
    const targetId = msgId || messages[messages.length - 1].id;
    const msgIndex = messages.findIndex(m => m.id === targetId);
    if (msgIndex === -1) return;
    
    const targetMsg = messages[msgIndex];
    if (targetMsg.role !== "model" || msgIndex === 0) return;

    const prevMsgs = messages.slice(0, msgIndex);
    
    const currentVersions = targetMsg.allContents || [targetMsg.content];
    if (currentVersions.length >= 30) {
      return;
    }

    const newIndex = currentVersions.length;
    const newVersions = [...currentVersions, ""];
    
    const updatedMsg: Message = { 
      ...targetMsg,
      content: "",
      allContents: newVersions,
      activeIndex: newIndex
    };

    const updatedMessages = [...messages];
    updatedMessages[msgIndex] = updatedMsg;
    
    if (user) {
      await saveMessageToFirestore(currentSessionId, updatedMsg);
    } else {
      updateSessionMessages(currentSessionId, updatedMessages);
    }

    setIsLoading(true);
    streamingMessageRef.current = { id: targetId, content: "" };
    try {
      let accumulated = "";
      const apiMessages = prevMsgs;
      const personalizedInstruction = `ĐẶC ĐIỂM NHÂN VẬT (Midorima):\n${charTraits}\n\n${systemInstruction}\n\nTHÔNG TIN VỀ {{user}} (Người đang trò chuyện với bạn):\n${userTraits}`;

      await chatStream(apiMessages, async (chunk) => {
        accumulated += chunk;
        if (streamingMessageRef.current && streamingMessageRef.current.id === targetId) {
          streamingMessageRef.current.content = accumulated;
        }
        if (user) {
          setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
              const msgs = [...s.messages];
              const target = msgs.find(m => m.id === targetId);
              if (target) {
                target.content = accumulated;
                if (!target.allContents) target.allContents = newVersions;
                target.allContents[newIndex] = accumulated;
                target.activeIndex = newIndex;
              }
              return { ...s, messages: msgs };
            }
            return s;
          }));
        } else {
          const versions = [...newVersions];
          versions[newIndex] = accumulated;

          const newMsgs = [...messages];
          newMsgs[msgIndex] = { ...updatedMsg, content: accumulated, allContents: versions, activeIndex: newIndex };
          updateSessionMessages(currentSessionId, newMsgs);
        }
      }, personalizedInstruction);

      if (user) {
        const finalMsg = { ...updatedMsg, content: accumulated };
        if (!finalMsg.allContents) finalMsg.allContents = newVersions;
        finalMsg.allContents[newIndex] = accumulated;
        finalMsg.activeIndex = newIndex;
        await saveMessageToFirestore(currentSessionId, finalMsg);
      }
    } catch (error: any) {
      console.error("Regenerate error:", error);
      let errorMsg = "⚠️ Lỗi tạo lại phản hồi.";
      if (error?.message?.includes("quota") || error?.message?.includes("429")) {
        errorMsg = "⚠️ Hết lượt sử dụng (Quota exceeded).";
      }
      
      if (user) {
        const errUpdate = { ...updatedMsg, content: errorMsg };
        await saveMessageToFirestore(currentSessionId, errUpdate);
      } else {
        const newMsgs = [...messages];
        newMsgs[msgIndex] = { ...updatedMsg, content: errorMsg };
        updateSessionMessages(currentSessionId, newMsgs);
      }
    } finally {
      streamingMessageRef.current = null;
      setIsLoading(false);
    }
  };

  const switchMessageVersion = async (msgId: string, direction: number) => {
    if (!currentSessionId || isLoading) return;
    const msgIndex = messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) return;
    const msg = messages[msgIndex];
    if (!msg.allContents || msg.allContents.length <= 1) return;

    let newIndex = (msg.activeIndex || 0) + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= msg.allContents.length) newIndex = msg.allContents.length - 1;

    const updatedMsg = {
      ...msg,
      activeIndex: newIndex,
      content: msg.allContents[newIndex]
    };

    if (user) {
      await saveMessageToFirestore(currentSessionId, updatedMsg);
    } else {
      const newMsgs = [...messages];
      newMsgs[msgIndex] = updatedMsg;
      updateSessionMessages(currentSessionId, newMsgs);
    }
  };

  const deleteSession = async (id: string) => {
    if (user) {
      try {
        const msgsSnap = await getDocs(collection(db, "sessions", id, "messages"));
        const batch = writeBatch(db);
        msgsSnap.forEach(d => batch.delete(d.ref));
        batch.delete(doc(db, "sessions", id));
        await batch.commit();
        if (currentSessionId === id) {
          setCurrentSessionId(null);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `sessions/${id}`);
      }
    } else {
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
      }
    }
  };

  const handleRenameSession = async (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    if (user) {
      try {
        await setDoc(doc(db, "sessions", id), { title: newTitle, updatedAt: serverTimestamp() }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `sessions/${id}`);
      }
    } else {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
    }
    setEditingSessionId(null);
  };

  const handleLogin = async () => {
    try {
      setAuthError(null);
      console.log('Initiating Google Login...');
      await signInWithGoogle();
      console.log('Google Login successful');
    } catch (error: any) {
      const isPopupClosed = error?.code === 'auth/popup-closed-by-user' || 
                            error?.message?.includes('popup-closed-by-user') ||
                            error?.code === 'auth/cancelled-popup-request' ||
                            error?.message?.includes('cancelled-popup-request');
      if (isPopupClosed) {
        console.warn('Popup closed or cancelled by user');
        setAuthError('Cửa sổ đăng nhập đã bị đóng trước khi hoàn tất.');
      } else {
        console.error('Login error full:', error);
        setAuthError(error?.message || 'Lỗi đăng nhập. Vui lòng thử lại.');
      }
    }
  };

  const handleSaveProfile = async () => {
    setUserTraits(tempUserTraits);
    localStorage.setItem("user_traits", tempUserTraits);
    if (user) {
      await saveUserConfigInFirestore({ userTraits: tempUserTraits });
    }
    setIsProfileOpen(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const resultSrc = reader.result as string;
        setUserAvatar(resultSrc);
        localStorage.setItem("user_avatar", resultSrc);
        if (user) {
          await saveUserConfigInFirestore({ userAvatar: resultSrc });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCharAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const resultSrc = reader.result as string;
        setCharAvatar(resultSrc);
        localStorage.setItem("char_avatar", resultSrc);
        if (user) {
          await saveUserConfigInFirestore({ charAvatar: resultSrc });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveSettings = async () => {
    setSystemInstruction(tempInstruction);
    setInitialPrompt(tempInitialPrompt);
    setCharTraits(tempCharTraitsState);

    localStorage.setItem("system_instruction", tempInstruction);
    localStorage.setItem("initial_prompt", tempInitialPrompt);
    localStorage.setItem("char_traits", tempCharTraitsState);

    if (user) {
      await saveUserConfigInFirestore({
        systemInstruction: tempInstruction,
        initialPrompt: tempInitialPrompt,
        charTraits: tempCharTraitsState
      });
    }
    setIsSettingsOpen(false);
  };

  return (
    <div className="flex h-screen bg-neutral-100 text-neutral-800 font-sans overflow-hidden">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative min-w-0 bg-white">
        <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-100 shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-neutral-400">Midorima Shintaro</h2>
          </div>
          <div className="flex items-center">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 mr-2 hover:bg-neutral-100 rounded-xl transition-all"
            >
              <Menu size={20} className="text-neutral-600" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 md:px-12 py-8 scrollbar-hide">
          <div className="max-w-3xl mx-auto flex flex-col items-center mb-12 text-center">
            <div className="w-24 h-24 rounded-full overflow-hidden mb-4 border-2 border-neutral-100 shadow-md">
              <img src={charAvatar} alt="Midorima" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-2xl font-bold font-display text-neutral-900">Midorima Shintaro</h1>
          </div>

          <div className="max-w-3xl mx-auto space-y-10 pb-32">
            <AnimatePresence mode="popLayout">
              {messages.map((msg, idx) => (
                <motion.div
                  key={msg.id || idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-4 group ${msg.role === "user" ? "justify-end" : ""}`}
                >
                  {msg.role === "model" && (
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 mt-1">
                      <img src={charAvatar} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  
                  <div className={`flex flex-col gap-1 max-w-[85%] ${msg.role === "user" ? "items-end" : ""}`}>
                    {msg.role === "model" && (
                      <div className="flex items-center gap-2 ml-1">
                        <span className="text-[11px] font-bold text-neutral-900">Midorima Shintaro</span>
                      </div>
                    )}
                    
                    <div className={`relative px-4 py-3 rounded-2xl text-[15px] leading-relaxed group/msg ${
                      msg.role === "user"
                        ? "bg-neutral-900 text-white shadow-sm"
                        : "bg-neutral-100 text-neutral-800"
                    }`}>
                      <div className="markdown-body">
                        <Markdown>{msg.content}</Markdown>
                      </div>

                      {/* Version Switcher */}
                      {msg.role === "model" && msg.allContents && msg.allContents.length > 1 && (
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-neutral-200/50 text-[10px] font-bold text-neutral-400">
                          <button 
                            onClick={() => switchMessageVersion(msg.id, -1)}
                            disabled={msg.activeIndex === 0}
                            className="p-0.5 hover:bg-neutral-200 rounded disabled:opacity-30"
                          >
                            <ChevronLeft size={10} />
                          </button>
                          <span>{(msg.activeIndex || 0) + 1} / {msg.allContents.length}</span>
                          <button 
                            onClick={() => switchMessageVersion(msg.id, 1)}
                            disabled={msg.activeIndex === (msg.allContents.length - 1)}
                            className="p-0.5 hover:bg-neutral-200 rounded disabled:opacity-30"
                          >
                            <ChevronRight size={10} />
                          </button>
                        </div>
                      )}

                      {idx === messages.length - 1 && isLoading && msg.role === "model" && !msg.content && (
                        <div className="flex gap-1 py-1">
                          <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce" />
                          <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                          <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                        </div>
                      )}
                    </div>

                    {/* Tooltips/Actions */}
                    <div className={`flex items-center gap-2 mt-1 ${
                      msg.role === "user" ? "justify-end mr-2" : "justify-start ml-2"
                    }`}>
                      {msg.role === "model" && idx > 0 && (
                        <div className="flex items-center gap-1.5 bg-white shadow-sm border border-neutral-100 rounded-full px-1.5 py-0.5">
                          <button 
                            onClick={() => handleRegenerate(msg.id)} 
                            disabled={isLoading || (msg.allContents?.length || 1) >= 30}
                            title="Tạo lại câu trả lời (Tối đa 30)"
                            className="text-neutral-400 hover:text-emerald-500 disabled:opacity-30 transition-colors p-1"
                          >
                            <RefreshCcw size={12} />
                          </button>
                          {msg.allContents && msg.allContents.length > 1 && (
                            <span className="text-[10px] font-bold text-neutral-400 select-none mr-1">
                              {msg.allContents.length}/30
                            </span>
                          )}
                        </div>
                      )}
                      
                      <div className="relative">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === msg.id ? null : msg.id);
                          }}
                          className="p-1 px-2 bg-white border border-neutral-100 rounded-full text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900 shadow-sm transition-all flex items-center gap-1"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        
                        <AnimatePresence>
                          {activeMenuId === msg.id && (
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.9, y: -5 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, y: -5 }}
                              className={`absolute bottom-full mb-2 w-48 bg-white border border-neutral-200 rounded-2xl shadow-xl z-20 py-2 ${
                                msg.role === "user" ? "right-0" : "left-0"
                              }`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button 
                                onClick={() => { copyToClipboard(msg.content); setActiveMenuId(null); }}
                                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-neutral-50 text-neutral-700 text-xs font-medium"
                              >
                                <Save size={14} className="text-neutral-400" />
                                Sao chép nội dung
                              </button>
                              <button 
                                onClick={() => { handleNewChatFromHere(msg.id); setActiveMenuId(null); }}
                                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-neutral-50 text-neutral-700 text-xs font-medium"
                              >
                                <Plus size={14} className="text-neutral-400" />
                                Tạo chat mới từ đây
                              </button>
                              <button 
                                onClick={() => { rewindToMessage(msg.id); setActiveMenuId(null); }}
                                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-neutral-50 text-neutral-700 text-xs font-medium border-t border-neutral-100 mt-1"
                              >
                                <RotateCcw size={14} className="text-neutral-400" />
                                Tua lại đến đây
                              </button>
                              <button 
                                onClick={() => { deleteMessage(msg.id); setActiveMenuId(null); }}
                                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-neutral-50 text-red-500 text-xs font-medium"
                              >
                                <Trash2 size={14} />
                                Xóa tin nhắn này
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                    </div>
                  </div>

                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 mt-1 border border-neutral-100 shadow-sm">
                      {userAvatar ? (
                        <img src={userAvatar} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full bg-neutral-200 flex items-center justify-center">
                          <User size={14} className="text-neutral-400" />
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        </main>

        <div className="absolute bottom-6 left-0 right-0 px-4 md:px-12 pointer-events-none">
          <div className="max-w-3xl mx-auto flex justify-center mb-4 pointer-events-auto">
             {!isLoading && messages.length > 0 && (
                <button 
                  onClick={handleContinue}
                  className="flex items-center gap-2 px-4 py-1.5 bg-white border border-neutral-200 rounded-full text-[12px] font-bold text-neutral-600 hover:bg-neutral-50 shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2"
                >
                  <RefreshCcw size={12} className="text-emerald-500" />
                  Tiếp diễn câu chuyện
                </button>
             )}
          </div>
          <ChatInput 
            onSend={handleSend}
            isLoading={isLoading}
            currentSessionId={currentSessionId}
          />
        </div>
      </div>

      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-neutral-900/20 backdrop-blur-[2px] z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isSidebarOpen ? (window.innerWidth < 768 ? "85%" : 320) : 0, 
          opacity: isSidebarOpen ? 1 : 0,
          x: isSidebarOpen ? 0 : (window.innerWidth < 768 ? 20 : 0)
        }}
        className={`fixed top-0 right-0 h-full bg-neutral-50 border-l border-neutral-200 flex flex-col z-50 md:relative md:z-auto transition-all shadow-2xl md:shadow-none overflow-hidden`}
      >
        <div className="w-full md:w-[320px] h-full flex flex-col pt-4 md:pt-0">
          <div className="flex justify-end p-2 md:hidden">
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-neutral-200 rounded-full">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <button 
              onClick={createNewChat}
              className="w-full flex items-center gap-3 px-4 py-3 bg-neutral-200/50 hover:bg-neutral-200 text-neutral-800 rounded-xl transition-all text-sm font-bold"
            >
              <Plus size={18} />
              Cuộc trò chuyện mới
            </button>

            <div className="space-y-1">
              <button 
                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                className={`w-full flex items-center justify-between p-3 hover:bg-neutral-200/30 rounded-xl transition-all group ${isHistoryOpen ? "bg-neutral-200/20" : ""}`}
              >
                <div className="flex items-center gap-3 text-neutral-700">
                  <History size={18} />
                  <span className="text-sm font-medium">Lịch sử</span>
                </div>
                <ChevronRight size={14} className={`text-neutral-400 transition-transform ${isHistoryOpen ? "rotate-90" : ""}`} />
              </button>
              
              <AnimatePresence>
                {isHistoryOpen && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden bg-neutral-200/10 rounded-xl mx-1"
                  >
                    <div className="py-2 space-y-1">
                      {sessions.length === 0 ? (
                        <p className="text-[11px] text-neutral-400 text-center py-4">Chưa có lịch sử</p>
                      ) : (
                        sessions.map(s => (
                          <div 
                            key={s.id}
                            onClick={() => setCurrentSessionId(s.id)}
                            className={`group flex items-center justify-between p-2 mx-2 rounded-lg cursor-pointer transition-all ${
                              currentSessionId === s.id ? "bg-white shadow-sm" : "hover:bg-white/50"
                            }`}
                          >
                            <div className="flex items-center gap-2 overflow-hidden flex-1">
                              <MessageSquare size={14} className={currentSessionId === s.id ? "text-neutral-800" : "text-neutral-400"} />
                              {editingSessionId === s.id ? (
                                <input
                                  autoFocus
                                  value={editingTitle}
                                  onChange={(e) => setEditingTitle(e.target.value)}
                                  onBlur={() => handleRenameSession(s.id, editingTitle)}
                                  onKeyDown={(e) => e.key === "Enter" && handleRenameSession(s.id, editingTitle)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs bg-neutral-100 border-none focus:ring-1 focus:ring-neutral-300 rounded px-1 w-full"
                                />
                              ) : (
                                <span className={`text-xs truncate ${currentSessionId === s.id ? "font-bold text-neutral-900" : "text-neutral-600"}`}>
                                  {s.title || "Trò chuyện mới"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 transition-opacity">
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setEditingSessionId(s.id); 
                                  setEditingTitle(s.title); 
                                }} 
                                className="p-1 hover:text-neutral-900 text-neutral-400"
                              >
                                <Edit3 size={12} />
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} 
                                className="p-1 hover:text-red-500 text-neutral-400"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="w-full flex items-center justify-between p-3 hover:bg-neutral-200/30 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-3 text-neutral-700">
                  <Settings2 size={18} />
                  <span className="text-sm font-medium">Tùy chỉnh</span>
                </div>
                <ChevronRight size={14} className="text-neutral-400" />
              </button>

              <button 
                onClick={() => setIsProfileOpen(true)}
                className="w-full flex items-center justify-between p-3 hover:bg-neutral-200/30 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-3 text-neutral-700">
                  <UserCircle size={18} />
                  <span className="text-sm font-medium">Chân dung</span>
                </div>
                <div className="flex items-center gap-1 overflow-hidden">
                   <span className="text-[10px] text-neutral-400 truncate max-w-[80px]">{userTraits}</span>
                   <ChevronRight size={14} className="text-neutral-400 shrink-0" />
                </div>
              </button>
            </div>
          </div>

          <div className="p-4 border-t border-neutral-200 bg-neutral-100/50 space-y-3">
            {authError && (
              <div className="bg-red-50 text-red-600 border border-red-200 rounded-xl p-3 text-xs font-semibold leading-relaxed animate-pulse">
                {authError}
              </div>
            )}

            {user ? (
              <div className="flex items-center justify-between bg-white border border-neutral-200 rounded-2xl p-3 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-9 h-9 rounded-full overflow-hidden border border-neutral-100 shrink-0">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt={user.displayName || ""} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full bg-neutral-200 flex items-center justify-center">
                        <User size={16} className="text-neutral-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-neutral-800 truncate leading-tight">
                      {user.displayName || "Người dùng Cloud"}
                    </span>
                    <span className="text-[10px] text-neutral-500 truncate leading-none mt-1">
                      {user.email || ""}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => logout()}
                  title="Đăng xuất"
                  className="p-2 text-neutral-400 hover:text-red-500 hover:bg-neutral-100 rounded-xl transition-all"
                >
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl transition-all text-xs font-bold shadow-lg shadow-neutral-900/10 hover:shadow-neutral-900/20"
              >
                <LogIn size={15} />
                Đăng nhập lưu trữ Cloud
              </button>
            )}

            <div className="text-[10px] text-center text-neutral-400 font-semibold uppercase tracking-wider py-1">
              {user ? "Đã đồng bộ hóa Cloud Firestore" : "Bản lưu trữ Local (Chưa đăng nhập)"}
            </div>
          </div>
        </div>
      </motion.aside>

      {/* User Profile Modal */}
      <AnimatePresence>
        {isProfileOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProfileOpen(false)}
              className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white border border-neutral-200 rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <UserCircle size={20} className="text-neutral-900" />
                  <h2 className="text-xl font-bold text-neutral-900">Hồ sơ người dùng</h2>
                </div>
                <button onClick={() => setIsProfileOpen(false)} className="p-2 hover:bg-neutral-100 rounded-xl transition-all"><X size={20} /></button>
              </div>

              <div className="p-8 space-y-8 flex flex-col items-center">
                <div className="relative group">
                  <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-neutral-100 shadow-lg bg-neutral-50 flex items-center justify-center">
                    {userAvatar ? (
                      <img src={userAvatar} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <User size={48} className="text-neutral-300" />
                    )}
                  </div>
                  <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-full cursor-pointer">
                    <span className="text-white text-xs font-bold uppercase">Đổi ảnh</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                  </label>
                </div>

                <div className="w-full space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-2 ml-1">Đặc điểm / Tính cách (Characteristics)</label>
                    <textarea
                      value={tempUserTraits}
                      onChange={(e) => setTempUserTraits(e.target.value)}
                      className="w-full h-[120px] bg-neutral-50 border border-neutral-200 rounded-2xl p-4 text-[16px] md:text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-neutral-200 text-neutral-700"
                      placeholder="Miêu tả bạn để Midorima có thể nhận diện..."
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-neutral-100 bg-neutral-50 flex justify-end gap-3">
                <button 
                  onClick={handleSaveProfile}
                  className="w-full py-3 bg-neutral-900 text-white rounded-full shadow-lg font-bold text-sm hover:bg-neutral-800 transition-all"
                >
                  Lưu hồ sơ
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white border border-neutral-200 rounded-3xl shadow-2xl overflow-hidden overflow-y-auto max-h-[90vh]"
            >
              <div className="p-6 border-b border-neutral-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <div className="flex items-center gap-3">
                  <Settings2 size={20} className="text-neutral-900" />
                  <h2 className="text-xl font-bold text-neutral-900">Thiết lập Midorima</h2>
                </div>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-neutral-100 rounded-xl transition-all"><X size={20} /></button>
              </div>

              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center mb-8">
                  <div className="relative group">
                    <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-neutral-100 shadow-lg bg-neutral-50">
                      <img src={charAvatar} alt="Character Avatar" className="w-full h-full object-cover" />
                    </div>
                    <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-full cursor-pointer">
                      <span className="text-white text-[10px] font-bold uppercase">Thay ảnh</span>
                      <input type="file" className="hidden" accept="image/*" onChange={handleCharAvatarUpload} />
                    </label>
                  </div>
                  <p className="mt-2 text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Ảnh đại diện Character</p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3 ml-1">Lời chào mở đầu (Initial Prompt)</label>
                  <textarea
                    value={tempInitialPrompt}
                    onChange={(e) => setTempInitialPrompt(e.target.value)}
                    className="w-full h-[120px] bg-neutral-50 border border-neutral-200 rounded-2xl p-4 text-[16px] md:text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-neutral-200 text-neutral-700 font-sans mb-6"
                    placeholder="Nhập lời mở đầu..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3 ml-1">Đặc điểm nhân vật (Character Traits)</label>
                  <textarea
                    value={tempCharTraitsState}
                    onChange={(e) => setTempCharTraitsState(e.target.value)}
                    className="w-full h-[100px] bg-neutral-50 border border-neutral-200 rounded-2xl p-4 text-[16px] md:text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-neutral-200 text-neutral-700 font-sans mb-6"
                    placeholder="Nhập đặc điểm của Midorima..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3 ml-1">Tính cách nhân vật (System Instruction)</label>
                  <textarea
                    value={tempInstruction}
                    onChange={(e) => setTempInstruction(e.target.value)}
                    className="w-full h-[400px] bg-neutral-50 border border-neutral-200 rounded-2xl p-4 text-[16px] md:text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-neutral-200 text-neutral-700 font-serif"
                    placeholder="Nhập tính cách của Midorima..."
                  />
                </div>
              </div>

              <div className="p-6 border-t border-neutral-100 bg-neutral-50 flex justify-end gap-3 sticky bottom-0">
                <button 
                  onClick={() => {
                    setTempInstruction(DEFAULT_SYSTEM_INSTRUCTION);
                    setTempInitialPrompt(DEFAULT_INITIAL_PROMPT);
                    setTempCharTraitsState("Vô cảm, nghiêm khắc, kỷ luật.");
                  }}
                  className="px-4 py-2 text-sm text-neutral-400 font-bold hover:text-neutral-900 transition-all uppercase tracking-wide"
                >
                  Mặc định
                </button>
                <button 
                  onClick={handleSaveSettings}
                  className="px-8 py-2 bg-neutral-900 text-white rounded-full shadow-lg font-bold text-sm hover:bg-neutral-800 transition-all"
                >
                  Lưu thay đổi
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

