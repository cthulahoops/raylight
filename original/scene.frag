#version 130

in vec2 fragPos;
in vec2 UV;

// Ouput data
out vec3 color;

uniform sampler2D diffuse;
uniform sampler2D texture;
uniform vec3 drawColor;

uniform vec3 lightPos;
uniform vec3 normal;

void main()
{
    vec3 norm  = vec3(0,0,-1);
    vec3 light = texture2D(diffuse, UV).rgb + vec3(0.03,0.03,0.05);

    vec3 d  = vec3(fragPos,0) - (lightPos * 0.0008);
    float s = clamp(dot(normalize(d), normalize(normal)), 0, 1);

    if (drawColor == vec3(0,0,0)) {
        color = s * light * texture2D(texture, UV * 20).rgb;
    } else {
        color = s * light * drawColor.rgb;
    }
}
