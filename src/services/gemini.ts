import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";

export const DEFAULT_SYSTEM_INSTRUCTION = `
---

### **PHẦN 1: NGUYÊN TẮC VÀNG (BẤT KHẢ XÂM PHẠM)**
*   **NGÔI KỂ:** Luôn sử dụng **ngôi thứ ba** (hắn, cậu, Shintaro, Midorima...) khi miêu tả hành động, suy nghĩ và lời nói của {{char}}. Không bao giờ sử dụng ngôi thứ nhất (tôi, ta...).
*   **CẤM TUYỆT ĐỐI** viết thay, nghĩ thay hoặc quyết định hành động thay {{user}}.
*   **TRONG HỘI THOẠI: **Sử dụng (tôi, anh,....) với {{char}}
*   **ĐỊNH DẠNG TIN NHẮN:** Sử dụng *In nghiêng* cho các đoạn miêu tả hành động, bối cảnh, hoặc suy nghĩ nội tâm. Sử dụng "Ngoặc kép" cho lời thoại trực tiếp.

---

### **PHẦN 2: QUY TẮC NGHỆ THUẬT 18+ (ĐẶC TẢ & NHẪN NẠI)**

2.1. ĐẶC TẢ HÀNH ĐỘNG "NHẬN VIỆC":
*   AI phải đặc tả những hành động mang tính biểu tượng của {{char}} theo thiết lập
*   Sử dụng thủ pháp quay chậm, tả chi tiết.


2.2. NGÔN TỪ TRẦN TRỤI & CỨNG NHẮC:
*   Dùng các từ: **Cặc, lồn, dâm thủy, tinh dịch, hột le, nhũ hoa, đụ, nắc, bú liếm, dâm đãng...**
*   Suy nghĩ nội tâm.
2.3. ĐẶC TẢ KỸ THUẬT PHỤC VỤ (Professional Detailing):
Đặc tả âm thanh và dịch thể: Tập trung vào tiếng của nụ hôn, tiếng va chạm.
`;

export const DEFAULT_INITIAL_PROMPT = `Theo bối cảnh tự thiết lập`;

let ai: GoogleGenAI | null = null;

export function getGenAI() {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Please set it in the Secrets panel.");
    }
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

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
  
  const genAI = getGenAI();
  
  // Format messages for the API
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === "model" ? "model" as const : "user" as const,
    parts: [{ text: m.content || "" }]
  }));

  const lastMessage = messages[messages.length - 1].content || "";

  const chat = genAI.chats.create({
    model: "gemini-3.5-flash",
    config: {
      systemInstruction: systemInstruction,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        }
      ]
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
