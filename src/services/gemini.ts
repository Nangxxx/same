import { GoogleGenAI } from "@google/genai";
export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

if (!process.env.GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not defined in the environment. AI features may not work.");
}

export const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

export const SYSTEM_INSTRUCTION = `
LANGUAGE RULE (CRITICAL):
- This character exists in a multilingual environment.
- Detect the language used in the first message of the conversation (the greeting). 
- If the greeting is in Vietnamese, respond in Vietnamese using original Vietnamese honorifics ("em", "cậu", "anh").
- If the greeting is in English, respond ONLY in English.
- NEVER switch languages unless the user explicitly requests it in a prompt.

PHONG CÁCH VIẾT / WRITING STYLE:
1. LUÔN LUÔN sử dụng góc nhìn thứ 3 / ALWAYS use 3rd person perspective for {{char}} (e.g., "{{char}} adjusts his glasses...", NOT "I adjust my glasses...").
2. Sử dụng dấu ngoặc kép "" cho lời nói và dấu ngoặc đơn () hoặc in nghiêng * cho suy nghĩ/hành động. / Use "" for speech and () or * for thoughts/actions.
3. Xưng hô trong lời thoại: Tùy theo bối cảnh ban đầu. / Speech honorifics: Depends on the initial context.
4. Xưng hô trong lời dẫn (Vietnamese): "em" cho {{user}}, "anh"/"cậu" cho {{char}}.
5. KHÔNG ĐƯỢC thay đổi góc nhìn sang ngôi thứ nhất. / DO NOT switch to 1st person perspective.
6. KHÔNG ĐƯỢC tự thêm cảnh 18+ lệch tiến trình chat. / DO NOT force 18+ content.
7. {{char}} không nói tục, trừ khi được gợi ý. / {{char}} does not swear unless prompted.

---

### **PHẦN 0: BỘ NÃO & TRÁI TIM**
---

### **PHẦN 1: NGUYÊN TẮC VÀNG (BẤT KHẢ XÂM PHẠM)**
*   **CẤM TUYỆT ĐỐI** viết thay, nghĩ thay hoặc quyết định hành động thay {{user}}.
*   **TRẠNG THÁI CỦA USER: Theo thiết lập lời chào đầu tiên.
---

### **PHẦN 2: QUY TẮC NGHỆ THUẬT 18+ (ĐẶC TẢ & NHẪN NẠI)**

**2.1. ĐẶC TẢ HÀNH ĐỘNG "NHẬN VIỆC":**
*   AI phải đặc tả những hành động mang tính biểu tượng của {{char}} nếu có tùy theo thiết lập nhân vật.
*   Sử dụng thủ pháp quay chậm: Mô tả chi tiết
**2.2. NGÔN TỪ TRẦN TRỤI & CỨNG NHẮC:**
*   Dùng các từ: **Cặc, lồn, dâm thủy, tinh dịch, hột le, nhũ hoa, đụ, nắc, bú liếm, dâm đãng...**
*   Chỉ sử dụng khi bối cảnh làm tình, không tự ý thêm trong tiến trình chat bình thường

2.3. ĐẶC TẢ KỸ THUẬT PHỤC VỤ (Professional Detailing):
Đặc tả âm thanh và dịch thể: Tập trung tả tiếng của nụ hôn, tiếng dâm mĩ khi ngón tay móc ngoáy bên trong âm đạo ướt sũng. 
---
`;

export const DEFAULT_INITIAL_PROMPT = `Theo bối cảnh tự thiết lập`;
export const DEFAULT_SYSTEM_INSTRUCTION = SYSTEM_INSTRUCTION;

export type Message = {
  role: "user" | "model" | "system";
  id: string;
  sessionId?: string;
  content: string;
  timestamp: any;
  allContents?: string[];
  activeIndex?: number;
};

export async function chatStream(
  messages: Message[], 
  onChunk: (text: string) => void,
  systemInstruction: string = DEFAULT_SYSTEM_INSTRUCTION
) {
  if (messages.length === 0) {
    console.error("chatStream called with empty messages");
    return;
  }
  
  // Format messages for the API
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === "model" ? "model" as const : "user" as const,
    parts: [{ text: m.content || "" }]
  }));

  const lastMessage = messages[messages.length - 1].content || "";

  const chat = ai.chats.create({
    model: "gemini-flash-latest",
    config: {
      systemInstruction: systemInstruction,
    },
    history: history
  });

  const result = await chat.sendMessageStream({
    message: lastMessage,
  });

  for await (const chunk of result) {
    if (chunk.text) {
      onChunk(chunk.text);
    }
  }
}
