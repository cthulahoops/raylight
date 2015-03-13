#version 130

in vec2 fragPos;

// Ouput data
out vec3 color;

uniform vec3 lightColor;

void main()
{
	color = lightColor;
}
